import { register } from '../nav.ts';
import { store, send } from '../store.ts';
import { C, art, btn, esc, footer, header, icon } from '../ui.ts';
import { on, onEach } from './util.ts';
import { lens, startLensPlayer, unlockAudio } from '../spotifyPlayer.ts';

/**
 * Spotify, cover-first: album art with a volume ring, round controls, a row of recent covers, and
 * every playlist below them (keep pressing down to reach them). Music plays on the glasses themselves
 * when their player is ready (spotifyPlayer.ts), otherwise on whatever device Spotify is open on.
 */

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
    const picks = (s.picks ?? []).slice(0, 5);
    const lists = s.playlists ?? [];
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
            ? `<div class="small g">${icon('glasses', 16)} playing on the glasses</div>`
            : btn('here', 'play on glasses', { cls: 'chip' });
    return `${header(t?.playing ? 'now playing' : 'music', C.green)}
    <main class="scroll">
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
        ${btn('vdown', '', { cls: 'round', icon: 'minus' })}
        ${btn('prev', '', { cls: 'round', icon: 'prev' })}
        ${btn('toggle', '', { cls: 'round main', icon: t?.playing ? 'pause' : 'play', def: true })}
        ${btn('next', '', { cls: 'round', icon: 'next' })}
        ${btn('vup', '', { cls: 'round', icon: 'plus' })}
      </div>
      ${picks.length ? `<div class="picks">${picks.map((p, i) => `<button class="pick" data-f="p:${i}" title="${esc(p.title)}">${art(p.art, p.title, 102)}</button>`).join('')}</div>` : ''}
      <div class="label">playlists · <span class="v">${lists.length}</span></div>
      ${
        lists.length
          ? `<div class="list">${lists
              .map(
                (p, i) => `<button class="item" data-f="pl:${i}">
                  ${art(p.art, p.title, 52)}
                  <span class="grow"><span class="y ellipsis" style="display:block">${esc(p.title)}</span>
                  <span class="small muted">${p.count != null ? `<span class="v">${p.count}</span> tracks` : 'playlist'}</span></span>
                </button>`,
              )
              .join('')}</div>`
          : '<div class="small muted">No playlists yet. They load a minute after you sign in.</div>'
      }
    </main>
    ${footer('pinch-twist sets volume · ↓ for covers and playlists')}`;
  },
  mount(root) {
    startLensPlayer();
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
    onEach(root, 'pl:', (i) => {
      const p = store.state?.playlists[Number(i)];
      if (p) act('playUri', p.uri);
    });
  },
});
