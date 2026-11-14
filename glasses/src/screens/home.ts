import { register, go } from '../nav.ts';
import { store } from '../store.ts';
import { C, esc, footer, header, icon } from '../ui.ts';
import { attachPixels } from '../pixels.ts';
import { onEach } from './util.ts';

register('home', {
  render() {
    const s = store.state;
    const sessions = s?.sessions ?? [];
    const running = sessions.filter((x) => x.status === 'running' || x.status === 'starting').length;
    const asks = (s?.approvals.length ?? 0) + (s?.questions.length ?? 0);

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
        ${tile('sessions', 'sessions', C.yellow, 'sessions', `<span class="v">${sessions.length}</span> · ${sessions.filter((x) => x.source === 'external').length} outside`)}
        ${tile('newSession', 'plus', C.green, 'new', 'pick a repo, dictate')}
        ${tile('twofa', 'key', C.purple, '2fa', s?.integrations.totp || s?.integrations.demo ? 'locked · swipe to open' : 'not set up')}
        ${tile('settings', 'gear', C.purple, 'settings', `approvals: ${s?.settings.approvals ?? '—'}<br>${store.connected ? 'relay ok' : '<span class="p">relay offline</span>'}`)}
      </div>
    </main>
    ${footer('swipe to move · pinch to open')}`;
  },
  mount(root) {
    attachPixels(root.querySelector('#pixels') as HTMLCanvasElement, store.state?.settings.animation ?? 'wave');
    onEach(root, 'tile:', (k) => go(k));
  },
});
