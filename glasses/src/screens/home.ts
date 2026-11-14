import { register, go } from '../nav.ts';
import { store, now } from '../store.ts';
import { C, clock, esc, footer, header, icon } from '../ui.ts';
import { attachPixels } from '../pixels.ts';
import { onEach } from './util.ts';

register('home', {
  render() {
    const s = store.state;
    const sessions = s?.sessions ?? [];
    const running = sessions.filter((x) => x.status === 'running' || x.status === 'starting').length;
    const asks = (s?.approvals.length ?? 0) + (s?.questions.length ?? 0);
    const next = s?.agenda.find((e) => e.end > now());
    const unreadMail = s?.mail.filter((m) => m.unread).length ?? 0;
    const unreadChat = s?.contacts.reduce((n, c) => n + (c.unread ?? 0), 0) ?? 0;
    const t = s?.track;

    const tile = (key: string, ic: string, color: string, title: string, sub: string, extra = '', cls = '') =>
      `<button class="tile ${cls}" data-f="tile:${key}">
        <span class="t" style="color:${color}">${icon(ic, 22)}<span>${title}</span>${extra}</span>
        <span class="s">${sub}</span>
      </button>`;

    return `${header('claude shell', C.pink)}
    <main>
      <canvas class="pixels" id="pixels"></canvas>
      <div class="tiles">
        ${tile(
          'claude',
          'claude',
          C.pink,
          'claude',
          `<span class="g">${running} run</span> · <span class="${asks ? 'o' : 'muted'}">${asks} ask</span><br>${esc(
            sessions[0]?.activity ?? 'no sessions yet',
          ).slice(0, 44)}`,
          asks ? `<span class="badge">${asks}</span>` : '',
          'wide',
        )}
        ${tile('comms', 'comms', C.cyan, 'comms', unreadChat ? `<span class="o">${unreadChat} unread</span><br>messages · whatsapp · calls` : 'messages · whatsapp · calls')}
        ${tile(
          'spotify',
          'music',
          C.green,
          t?.playing ? 'playing' : 'music',
          t ? `<span class="y">${esc(t.title)}</span><br>${esc(t.artist)}` : s?.integrations.spotify ? 'nothing playing' : 'not connected',
          '',
          'wide',
        )}
        ${tile('agenda', 'agenda', C.yellow, 'agenda', next ? `<span class="v">${clock(next.start)}</span> ${esc(next.title)}` : 'nothing else today')}
        ${tile('mail', 'mail', C.orange, 'mail', unreadMail ? `<span class="v">${unreadMail}</span> unread · ${esc(s!.mail.find((m) => m.unread)!.from)}` : 'inbox zero')}
        ${tile('route', 'map', C.cyan, 'maps', next?.location ? `to ${esc(next.location).slice(0, 26)}` : 'favorites')}
        ${tile('photos', 'photo', C.cyan, 'photos', s?.integrations.photos ? 'library · from glasses' : 'not set up')}
        ${tile('twofa', 'key', C.purple, '2fa', s?.integrations.totp ? 'locked · swipe to open' : 'opt-in')}
        ${tile('links', 'globe', C.cyan, 'links', 'youtube · x · discord')}
        ${tile('settings', 'gear', C.purple, 'settings', `approvals: ${s?.settings.approvals ?? '—'}<br>${store.connected ? 'relay ok' : '<span class="p">relay offline</span>'}`)}
      </div>
    </main>
    ${footer('swipe to move · pinch to open')}`;
  },
  mount(root) {
    const s = store.state;
    attachPixels(root.querySelector('#pixels') as HTMLCanvasElement, s?.settings.animation ?? 'wave');
    onEach(root, 'tile:', (k) => go(k === 'claude' ? 'claude' : k));
  },
});
