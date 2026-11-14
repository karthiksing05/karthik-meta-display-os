import { config } from '../config.ts';
import { hub, state } from '../hub.ts';

/**
 * Calendar + Gmail for the lens come from your own Apps Script web app
 * (integrations/google-apps-script/Code.gs). It runs as you inside Google,
 * so there is no OAuth app to verify and no weekly re-login.
 * Claude sessions use Claude's own Gmail/Calendar connectors for deeper work.
 */
export async function pollGoogle() {
  if (!config.googleFeedUrl) return;
  try {
    const u = new URL(config.googleFeedUrl);
    u.searchParams.set('secret', config.googleFeedSecret);
    const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const data = (await res.json()) as { events?: any[]; mail?: any[]; error?: string };
    if (data.error) throw new Error(data.error);
    state.agenda = (data.events ?? []).map((e) => ({
      id: String(e.id),
      title: String(e.title ?? '(no title)'),
      start: Number(e.start),
      end: Number(e.end),
      location: e.location || null,
      meetUrl: e.meetUrl || null,
    }));
    state.mail = (data.mail ?? []).map((m) => ({
      id: String(m.id),
      from: String(m.from ?? ''),
      subject: String(m.subject ?? ''),
      snippet: String(m.snippet ?? ''),
      at: Number(m.at),
      unread: Boolean(m.unread),
    }));
    hub.changed();
  } catch (e) {
    console.warn('[google]', (e as Error).message);
  }
}
