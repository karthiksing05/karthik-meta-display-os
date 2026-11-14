import type { Contact } from '../../../shared/protocol.ts';
import { config } from '../config.ts';
import { hub, state } from '../hub.ts';
import { load, save } from '../store.ts';

/**
 * Comms pane data.
 * - Contacts: DATA_DIR/contacts.json (edit by hand; a sample is written on first run).
 * - iMessage: optional BlueBubbles server on a Mac (bluebubbles.app). Threads and sending.
 * - WhatsApp + calls: no safe API for personal accounts, so the lens hands off to
 *   the built-in glasses apps (wa.me / tel: links). Unofficial bridges risk a ban.
 */
const SAMPLE: Contact[] = [
  { id: 'c1', name: 'Mom', initials: 'M', phone: '+15555550100', whatsapp: true },
  { id: 'c2', name: 'Alex', initials: 'A', phone: '+15555550101', whatsapp: false },
];

export function loadContacts() {
  const contacts = load<Contact[] | null>('contacts', null);
  if (!contacts) save('contacts', SAMPLE);
  state.contacts = (contacts ?? SAMPLE).map((c) => ({
    ...c,
    initials: c.initials || c.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
  }));
  hub.changed();
}

async function bb(path: string, body?: unknown) {
  const u = new URL(`${config.bbUrl}/api/v1${path}`);
  u.searchParams.set('password', config.bbPassword);
  const res = await fetch(u, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`bluebubbles ${path} ${res.status}`);
  return ((await res.json()) as { data: any }).data;
}

/** Merge recent iMessage threads into the contact list (matched by chat GUID or phone). */
export async function pollMessages() {
  if (!config.bbUrl) return;
  try {
    const chats: any[] = await bb('/chat/query', { limit: 20, offset: 0, with: ['lastMessage', 'participants'], sort: 'lastmessage' });
    for (const chat of chats) {
      const handle = chat.participants?.[0]?.address as string | undefined;
      const digits = (s?: string) => (s ?? '').replace(/\D/g, '').slice(-10);
      let c = state.contacts.find((x) => x.chatGuid === chat.guid || (handle && digits(x.phone) === digits(handle)));
      if (!c) {
        const name = chat.displayName || handle || 'Unknown';
        c = { id: `bb-${chat.guid}`, name, initials: name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '#' };
        state.contacts.push(c);
      }
      c.chatGuid = chat.guid;
      const m = chat.lastMessage;
      if (m) {
        c.lastText = (m.isFromMe ? 'you: ' : '') + String(m.text ?? '').slice(0, 120);
        c.lastAt = m.dateCreated;
        c.lastSource = 'messages';
      }
    }
    state.contacts.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
    hub.changed();
  } catch (e) {
    console.warn('[messages]', (e as Error).message);
  }
}

export async function sendMessage(contactId: string, text: string) {
  const c = state.contacts.find((x) => x.id === contactId);
  if (!c?.chatGuid) throw new Error('No iMessage thread for this contact (BlueBubbles needed)');
  await bb('/message/text', { chatGuid: c.chatGuid, message: text, tempGuid: `shell-${Date.now()}`, method: 'apple-script' });
  c.lastText = `you: ${text}`;
  c.lastAt = Date.now();
  hub.changed();
}
