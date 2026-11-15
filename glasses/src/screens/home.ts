import { register, go } from '../nav.ts';
import { store } from '../store.ts';
import { BRAND, C, esc, footer, header, icon } from '../ui.ts';
import { attachPixels } from '../pixels.ts';
import { hubBody, hubMount } from './claude.ts';
import { on } from './util.ts';

/**
 * Home is the Claude hub, on one screen with no scrolling: the pixel band, "how's everything going?"
 * (focused first) with the last report next to it, anything waiting on you (approvals, Claude's
 * questions), and one row of tiles: sessions, new, chat, music (Spotify), 2fa, settings.
 */
register('home', {
  render() {
    const s = store.state;
    const sessions = s?.sessions ?? [];
    const running = sessions.filter((x) => x.status === 'running' || x.status === 'starting').length;
    const asks = (s?.approvals.length ?? 0) + (s?.questions.length ?? 0);

    // One row of six small tiles: icon, title, one short line.
    const tile = (key: string, ic: string, color: string, title: string, sub: string) =>
      `<button class="tile" data-f="tile:${key}" style="height:76px;padding:7px 8px;gap:2px;min-width:0">
        <span style="color:${color};line-height:0">${icon(ic, 18)}</span>
        <span class="small ellipsis" style="color:${color};font-weight:700">${title}</span>
        <span class="s ellipsis" style="font-size:12px">${sub}</span>
      </button>`;

    const label = `<div class="row" style="gap:8px">${icon('claude', 18, C.orange)}<span style="color:${C.orange};font-weight:700">claude</span>
      <span class="small"><span class="g">${running} running</span> · <span class="${asks ? 'o' : 'muted'}">${asks} waiting on you</span></span></div>`;

    const h = s?.host;
    const t = s?.track;
    const tiles = `<div class="tiles" style="grid-template-columns:repeat(6,minmax(0,1fr));gap:6px">
        ${tile('sessions', 'sessions', C.yellow, 'sessions', `<span class="v">${sessions.length}</span> · ${running} run`)}
        ${tile('newSession', 'plus', C.green, 'new', 'repo')}
        ${tile('chat', 'ask', C.orange, 'chat', 'no repo')}
        ${tile('spotify', 'music', C.green, 'music', t ? `${t.playing ? '▶' : '❚❚'} ${esc(t.title)}` : s?.integrations.spotify ? 'nothing on' : 'sign in')}
        ${tile('twofa', 'key', C.purple, '2fa', s?.integrations.totp || s?.integrations.demo ? 'locked' : 'off')}
        ${tile('settings', 'gear', C.purple, 'settings', store.connected ? `mac ${h?.battery ?? '—'}%${h?.charging ? '⚡' : ''}` : '<span class="p">offline</span>')}
      </div>`;

    return `${header(BRAND)}
    <main style="gap:8px">
      <canvas class="pixels" id="pixels"></canvas>
      ${hubBody(tiles, label)}
    </main>
    ${footer('swipe to move · pinch to select')}`;
  },
  mount(root) {
    attachPixels(root.querySelector('#pixels') as HTMLCanvasElement);
    hubMount(root);
    for (const k of ['sessions', 'newSession', 'spotify', 'twofa', 'settings']) on(root, `tile:${k}`, () => go(k));
    on(root, 'tile:chat', () => go('compose', { kind: 'new', repo: '', title: 'chat with claude' }));
  },
});
