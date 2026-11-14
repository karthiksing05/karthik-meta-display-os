import { register, go } from '../nav.ts';
import { store } from '../store.ts';
import { C, ago, agoText, btn, esc, footer, header, icon } from '../ui.ts';
import { on, onEach } from './util.ts';
import type { Contact } from '../../../shared/protocol.ts';

/**
 * Comms: one pane for Messages, WhatsApp and calls.
 * - Messages (iMessage) are read and sent through BlueBubbles on the relay.
 * - WhatsApp, calls and video hand off to the glasses' built-in apps through
 *   wa.me / tel: links. Personal WhatsApp has no safe API; bridges risk a ban.
 */
type Filter = 'all' | 'messages' | 'whatsapp' | 'calls';
let filter: Filter = 'all';

const SRC: Record<string, [string, string]> = {
  messages: ['msg', C.cyan],
  whatsapp: ['wa', C.green],
  call: ['call', C.orange],
};

const AVATAR = [C.pink, C.cyan, C.green, C.orange, C.purple, C.yellow];
const avatar = (c: Contact) =>
  `<span class="avatar" style="background:${AVATAR[[...c.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR.length]}">${esc(c.initials)}</span>`;

function visible(list: Contact[]) {
  if (filter === 'messages') return list.filter((c) => c.chatGuid || c.lastSource === 'messages');
  if (filter === 'whatsapp') return list.filter((c) => c.whatsapp);
  if (filter === 'calls') return list.filter((c) => c.phone);
  return list;
}

register('comms', {
  render() {
    const list = visible(store.state?.contacts ?? []);
    const tab = (f: Filter) => btn(`f:${f}`, f, { cls: `chip ${filter === f ? 'primary' : ''}` });
    return `${header('comms', C.cyan)}
    <main class="scroll">
      <div class="seg">${tab('all')}${tab('messages')}${tab('whatsapp')}${tab('calls')}</div>
      <div class="list">${
        list
          .map((c) => {
            const [s, col] = SRC[c.lastSource ?? ''] ?? ['', C.cm];
            return `<button class="item" data-f="c:${esc(c.id)}">${avatar(c)}
              <span class="grow">
                <span class="row"><span class="y grow ellipsis">${esc(c.name)}</span>${s ? `<span class="src" style="color:${col}">${s}</span>` : ''}<span class="small muted">${ago(c.lastAt)}</span></span>
                <span class="small muted ellipsis" style="display:block">${esc(c.lastText ?? (c.phone ?? ''))}</span>
              </span>
              ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}
            </button>`;
          })
          .join('') || '<div class="muted">No contacts. Add them in contacts.json on the relay.</div>'
      }</div>
    </main>
    ${footer('pinch a contact to message, WhatsApp or call')}`;
  },
  mount(root) {
    onEach(root, 'f:', (f) => {
      filter = f as Filter;
      store.emit();
    });
    onEach(root, 'c:', (id) => go('contact', { id }));
  },
});

register('contact', {
  render({ id }) {
    const c = store.state?.contacts.find((x) => x.id === id);
    if (!c) return `${header('contact')}<main class="center muted">Not found.</main>`;
    const canText = Boolean(c.chatGuid) && store.state?.integrations.messages;
    return `${header(c.name, C.yellow)}
    <main>
      <div class="row">${avatar(c)}<div class="grow"><div class="y">${esc(c.name)}</div><div class="small muted">${esc(c.phone ?? '')}</div></div></div>
      ${c.lastText ? `<div class="card">${esc(c.lastText)}<div class="small muted">${agoText(c.lastAt)}</div></div>` : ''}
      <div class="tiles">
        ${canText ? `<button class="tile" data-f="msg" data-default><span class="t c">${icon('comms')}message</span><span class="s">iMessage · dictate</span></button>` : ''}
        ${c.whatsapp && c.phone ? `<button class="tile" data-f="wa"><span class="t g">${icon('wa')}whatsapp</span><span class="s">opens built-in app</span></button>` : ''}
        ${c.phone ? `<button class="tile" data-f="call"><span class="t o">${icon('phone')}call</span><span class="s">via your phone</span></button>` : ''}
        ${c.phone ? `<button class="tile" data-f="video"><span class="t v">${icon('video')}video</span><span class="s">${c.whatsapp ? 'whatsapp video' : 'facetime on phone'}</span></button>` : ''}
      </div>
      <div class="small muted">WhatsApp and calls hand off to the glasses' own apps.</div>
    </main>
    ${footer('back to comms')}`;
  },
  mount(root, { id }) {
    const c = store.state?.contacts.find((x) => x.id === id);
    if (!c) return;
    const digits = (c.phone ?? '').replace(/[^\d+]/g, '');
    on(root, 'msg', () => go('compose', { kind: 'comms', contactId: c.id, title: `to ${c.name}` }));
    on(root, 'wa', () => (location.href = `https://wa.me/${digits.replace('+', '')}`));
    on(root, 'call', () => (location.href = `tel:${digits}`));
    on(root, 'video', () => (location.href = c.whatsapp ? `https://wa.me/${digits.replace('+', '')}` : `facetime:${digits}`));
  },
});
