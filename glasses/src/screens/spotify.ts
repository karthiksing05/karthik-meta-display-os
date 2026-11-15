import { register, go, back } from '../nav.ts';
import { store, send } from '../store.ts';
import { C, art, btn, esc, footer, header, icon } from '../ui.ts';
import { on, onEach } from './util.ts';
import { lens, startLensPlayer, unlockAudio } from '../spotifyPlayer.ts';

/**
 * Spotify, cover-first, in the app's pixel style: pixelated album art with a volume ring, pixel-art
 * controls, and a row of covers to pick something else. Music plays on the glasses themselves when
 * their player is ready (spotifyPlayer.ts), otherwise on whatever device Spotify is open on.
 */

/** Pixel-art icons, 9×9: X = lit. */
const PX: Record<string, string[]> = {
  play: ['.........', '.XX......', '.XXXX....', '.XXXXXX..', '.XXXXXXX.', '.XXXXXX..', '.XXXX....', '.XX......', '.........'],
  pause: ['.........', '.XXX.XXX.', '.XXX.XXX.', '.XXX.XXX.', '.XXX.XXX.', '.XXX.XXX.', '.XXX.XXX.', '.XXX.XXX.', '.........'],
  next: ['.........', '.X....XX.', '.XXX..XX.', '.XXXX.XX.', '.XXXXXXX.', '.XXXX.XX.', '.XXX..XX.', '.X....XX.', '.........'],
  prev: ['.........', '.XX....X.', '.XX..XXX.', '.XX.XXXX.', '.XXXXXXX.', '.XX.XXXX.', '.XX..XXX.', '.XX....X.', '.........'],
  plus: ['.........', '...XXX...', '...XXX...', '.XXXXXXX.', '.XXXXXXX.', '.XXXXXXX.', '...XXX...', '...XXX...', '.........'],
  minus: ['.........', '.........', '.........', '.XXXXXXX.', '.XXXXXXX.', '.XXXXXXX.', '.........', '.........', '.........'],
  note: ['....XXXX.', '....XXXX.', '....X..X.', '....X..X.', '....X..X.', '.XXXX.XXX', 'XXXXXXXXX', 'XXXX.XXX.', '.XX......'],
  glasses: ['.........', '.........', 'XXXX.XXXX', 'X..XXX..X', 'X..X.X..X', 'XXXX.XXXX', '.........', '.........', '.........'],
};
function pix(name: string, size: number, color = 'currentColor') {
  const rows = PX[name];
  const cells = rows.flatMap((r, y) => [...r].map((ch, x) => (ch === 'X' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ''))).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 9 9" fill="${color}" shape-rendering="crispEdges" aria-hidden="true">${cells}</svg>`;
}
const pbtn = (key: string, name: string, cls = 'round', def = false) =>
  `<button class="btn ${cls}" data-f="${key}" ${def ? 'data-default' : ''}>${pix(name, cls.includes('main') ? 36 : 27)}</button>`;

/** Album art at a few dots per side, like the rest of the app (an image that fails to load stays as it is). */
function pixelate(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>('img.cover').forEach((img) => {
    const size = Number(img.getAttribute('width')) || img.width;
    const n = Math.max(6, Math.round(size / 8)); // about 8 px per dot
    const draw = () => {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      c.getContext('2d')!.drawImage(img, 0, 0, n, n);
      c.className = 'cover';
      c.style.cssText = `${img.style.cssText};width:${size}px;height:${size}px;image-rendering:pixelated`;
      img.replaceWith(c);
    };
    if (img.complete && img.naturalWidth) draw();
    else img.addEventListener('load', draw, { once: true });
  });
}
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function ring(vol: number | null, size: number) {
  const r = size / 2 + 6;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, vol ?? 0)) / 100;
  const s = size + 20;
  return `<svg class="r" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="#3e3d32" stroke-width="4"/>
    <circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="${C.green}" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${s / 2} ${s / 2})"/>
  </svg>`;
}

register('spotify', {
  render() {
    const s = store.state;
    const t = s?.track;
    if (!s?.integrations.spotify) {
      return `${header('music', C.green)}
      <main class="center"><div>
        <div>${icon('music', 48, C.green)}</div>
        <div>Spotify isn't connected.</div>
        <div class="small muted">On your Mac, open<br><span class="c">${esc(location.origin)}/spotify/login?k=&lt;SHELL_TOKEN&gt;</span><br>once and sign in. Spotify Premium is needed to control playback.</div>
      </div></main>${footer('back')}`;
    }
    const picks = (s.picks ?? []).slice(0, 4);
    const onGlasses = t?.device === 'ClaudeProd glasses';
    const where = s.integrations.demo
      ? ''
      : !s.integrations.spotifyPlayer
      ? `<div class="small o">sign in to Spotify again to play on the glasses</div>`
      : lens.error
        ? `<div class="small o">${esc(lens.error)}</div>`
        : !lens.ready
          ? `<div class="small muted">starting the glasses player…</div>`
          : onGlasses || !t
            ? `<div class="small g">${pix('glasses', 16)} playing on the glasses</div>`
            : btn('here', 'play on glasses', { cls: 'chip' });
    return `${header(t?.playing ? 'now playing' : 'music', C.green)}
    <main>
      <div class="np">
        <div class="ring" style="margin:10px">${art(t?.art ?? null, t?.album ?? 'none', 200).replace('class="cover"', 'class="cover" style="border-radius:50%"')}${ring(t?.volume ?? null, 200)}</div>
        <div class="grow">
          <div class="y clamp2" style="font-size:21px;font-weight:700">${esc(t?.title ?? 'Nothing playing')}</div>
          <div>${esc(t?.artist ?? '')}</div>
          <div class="small muted ellipsis">${esc(t?.album ?? '')}</div>
          ${
            t
              ? `<div style="margin-top:10px" class="bar"><i style="width:${(100 * t.progressMs) / Math.max(1, t.durationMs)}%;background:${C.green}"></i></div>
                 <div class="row small muted"><span class="v">${mmss(t.progressMs)}</span><span class="grow"></span><span>${mmss(t.durationMs)}</span></div>
                 <div class="small muted">${esc(onGlasses ? 'glasses' : t.device ?? '')} · vol <span class="v">${t.volume ?? '—'}</span></div>`
              : ''
          }
          <div style="margin-top:8px">${where}</div>
        </div>
      </div>
      <div class="row" style="justify-content:center;gap:14px">
        ${pbtn('vdown', 'minus')}
        ${pbtn('prev', 'prev')}
        ${pbtn('toggle', t?.playing ? 'pause' : 'play', 'round main', true)}
        ${pbtn('next', 'next')}
        ${pbtn('vup', 'plus')}
      </div>
      <div class="picks">${picks.map((p, i) => `<button class="pick" data-f="p:${i}" title="${esc(p.title)}">${art(p.art, p.title, 102)}</button>`).join('')}<button class="pick pl-tile" data-f="playlists">${pix('note', 30, C.green)}<span class="small">playlists</span><span class="small muted">${s.playlists?.length ?? 0}</span></button></div>
    </main>
    ${footer('pinch-twist also sets volume · ↓ to pick a cover')}`;
  },
  mount(root) {
    startLensPlayer();
    pixelate(root);
    const t = store.state?.track;
    const vol = t?.volume ?? 50;
    // Every pinch also unlocks audio for the glasses player (browsers need a user action first).
    const act = (action: 'play' | 'pause' | 'next' | 'prev' | 'volume' | 'playUri' | 'here', value?: number | string) => {
      unlockAudio();
      send({ t: 'spotify', action, value });
    };
    on(root, 'toggle', () => act(t?.playing ? 'pause' : 'play'));
    on(root, 'prev', () => act('prev'));
    on(root, 'next', () => act('next'));
    on(root, 'vdown', () => act('volume', vol - 10));
    on(root, 'vup', () => act('volume', vol + 10));
    on(root, 'here', () => act('here'));
    onEach(root, 'p:', (i) => {
      const p = store.state?.picks[Number(i)];
      if (p) act('playUri', p.uri);
    });
    on(root, 'playlists', () => go('playlists'));
  },
});

/** Every playlist (yours and the ones you follow): pinch one to play it, then back to the player. */
register('playlists', {
  render() {
    const list = store.state?.playlists ?? [];
    const playing = store.state?.track;
    return `${header('playlists', C.green)}
    <main class="scroll">
      ${
        list.length
          ? `<div class="list">${list
              .map(
                (p, i) => `<button class="item" data-f="pl:${i}" ${i === 0 ? 'data-default' : ''}>
                  ${art(p.art, p.title, 52)}
                  <span class="grow"><span class="y ellipsis" style="display:block">${esc(p.title)}</span>
                  <span class="small muted">${p.count != null ? `<span class="v">${p.count}</span> tracks` : 'playlist'}</span></span>
                </button>`,
              )
              .join('')}</div>`
          : '<div class="center muted">No playlists yet. They load a minute after you sign in.</div>'
      }
    </main>
    ${footer(playing ? `now: ${esc(playing.title)} · pinch to play` : 'pinch a playlist to play it')}`;
  },
  mount(root) {
    pixelate(root);
    onEach(root, 'pl:', (i) => {
      const p = store.state?.playlists[Number(i)];
      if (!p) return;
      unlockAudio();
      send({ t: 'spotify', action: 'playUri', value: p.uri });
      back();
    });
  },
});
