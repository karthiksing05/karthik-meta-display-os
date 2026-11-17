import { register, go } from '../nav.ts';
import { store } from '../store.ts';
import { BRAND, C, esc, footer, header, icon } from '../ui.ts';
import { attachPixels } from '../pixels.ts';
import { hubBody, hubMount } from './claude.ts';
import { on } from './util.ts';

/**
 * Home is the Claude hub, on one screen with no scrolling: the pixel band, "how's everything going?"
 * (focused first) with the last report next to it, anything waiting on you (approvals, Claude's
 * questions, one line each), and two rows of tiles: sessions, new, chat, notes, 2fa, settings.
 */
register('home', {
  render() {
    const s = store.state;
    const sessions = s?.sessions ?? [];
    const running = sessions.filter((x) => x.status === 'running' || x.status === 'starting').length;
    const asks = (s?.approvals.length ?? 0) + (s?.questions.length ?? 0);

    // Two rows of three tiles: icon and title, then one short line.
    const tile = (key: string, ic: string, color: string, title: string, sub: string, wide = false) =>
      `<button class="tile${wide ? ' wide' : ''}" data-f="tile:${key}" style="height:74px;padding:8px 10px;gap:4px;min-width:0">
        <span class="t" style="color:${color};gap:8px">${icon(ic, 19)}<span class="ellipsis">${title}</span></span>
        <span class="s ellipsis" style="font-size:13px">${sub}</span>
      </button>`;

    const label = `<div class="row" style="gap:8px">${icon('claude', 18, C.orange)}<span style="color:${C.orange};font-weight:700">claude</span>
      <span class="small"><b class="n g">${running}</b> <span class="g">running</span> · <b class="n ${asks ? 'o' : 'muted'}">${asks}</b> <span class="${asks ? 'o' : 'muted'}">waiting on you</span></span></div>`;

    const h = s?.host;
    const tiles = `<div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
        ${tile('sessions', 'sessions', C.yellow, 'sessions', `<b class="n g">${running}</b> <span class="g">running</span> <span class="muted">of</span> <span class="v">${sessions.length}</span>`)}
        ${tile('newSession', 'plus', C.green, 'new', 'in a repo')}
        ${tile('chat', 'ask', C.orange, 'chat', 'no repo')}
        ${tile('notes', 'note', C.cyan, 'notes', 'dictate a change')}
        ${tile('twofa', 'key', C.purple, '2fa', !s || !store.connected ? '—' : s.integrations.totp || s.integrations.demo ? 'locked' : 'off')}
        ${tile('settings', 'gear', C.purple, 'settings', store.connected ? `mac ${h?.battery ?? '—'}%${h?.charging ? '⚡' : ''}` : '<span class="p">offline</span>')}
      </div>`;

    return `${header(BRAND)}
    <main style="gap:8px">
      <canvas class="pixels" id="pixels"></canvas>
      ${hubBody(tiles, label, true)}
    </main>
    ${footer('swipe to move · pinch to select')}`;
  },
  mount(root) {
    attachPixels(root.querySelector('#pixels') as HTMLCanvasElement);
    hubMount(root);
    for (const k of ['sessions', 'newSession', 'twofa', 'settings']) on(root, `tile:${k}`, () => go(k));
    on(root, 'tile:notes', () => go('compose', { kind: 'notes', title: 'notes', auto: Date.now() }));
    on(root, 'tile:chat', () => go('compose', { kind: 'new', repo: '', title: 'chat with claude' }));
  },
});
