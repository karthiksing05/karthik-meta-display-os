import { register, go } from '../nav.ts';
import { store } from '../store.ts';
import { BRAND, C, footer, header, icon } from '../ui.ts';
import { attachPixels } from '../pixels.ts';
import { hubBody, hubKey, hubMount } from './claude.ts';
import { on } from './util.ts';

/**
 * Home is the Claude hub: the pixel band, then "how's everything going?" (focused first), anything
 * waiting on you, the tiles (sessions, new, chat, 2fa, settings), and the ask bar and quick sends.
 * It scrolls; the band scrolls away as you move down.
 */
register('home', {
  render() {
    const s = store.state;
    const sessions = s?.sessions ?? [];
    const running = sessions.filter((x) => x.status === 'running' || x.status === 'starting').length;
    const asks = (s?.approvals.length ?? 0) + (s?.questions.length ?? 0);

    const tile = (key: string, ic: string, color: string, title: string, sub: string, cls = '') =>
      `<button class="tile ${cls}" data-f="tile:${key}" style="height:84px">
        <span class="t" style="color:${color}">${icon(ic, 20)}<span>${title}</span></span>
        <span class="s">${sub}</span>
      </button>`;

    const label = `<div class="row" style="gap:8px;margin-top:2px">${icon('claude', 18, C.orange)}<span style="color:${C.orange};font-weight:700">claude</span>
      <span class="small"><span class="g">${running} running</span> · <span class="${asks ? 'o' : 'muted'}">${asks} waiting on you</span></span></div>`;

    const tiles = `<div class="tiles">
        ${tile('sessions', 'sessions', C.yellow, 'sessions', `<span class="v">${sessions.length}</span> · ${sessions.filter((x) => x.source === 'external').length} outside`)}
        ${tile('newSession', 'plus', C.green, 'new', 'pick a repo')}
        ${tile('chat', 'ask', C.orange, 'chat', 'no repo, connectors')}
        ${tile('twofa', 'key', C.purple, '2fa', s?.integrations.totp || s?.integrations.demo ? 'locked' : 'not set up')}
        ${tile('settings', 'gear', C.purple, 'settings', `mac ${s?.host.battery ?? '—'}%${s?.host.charging ? ' ⚡' : ''} · ${s?.host.wifi === 'connected' ? 'wi-fi' : '<span class="o">no wi-fi</span>'} · ${store.connected ? 'relay ok' : '<span class="p">relay offline</span>'}`, 'wide')}
      </div>`;

    return `${header(BRAND)}
    <main class="scroll">
      <canvas class="pixels" id="pixels"></canvas>
      ${hubBody(tiles, label)}
    </main>
    ${footer('swipe to move · pinch to select')}`;
  },
  key: hubKey,
  mount(root) {
    attachPixels(root.querySelector('#pixels') as HTMLCanvasElement);
    hubMount(root);
    for (const k of ['sessions', 'newSession', 'twofa', 'settings']) on(root, `tile:${k}`, () => go(k));
    on(root, 'tile:chat', () => go('compose', { kind: 'new', repo: '', title: 'chat with claude' }));
  },
});
