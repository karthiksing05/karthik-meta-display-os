import { register, go, back } from '../nav.ts';
import { store, send } from '../store.ts';
import { C, art, btn, esc, footer, header, icon } from '../ui.ts';
import { on, onEach } from './util.ts';

/**
 * Spotify, cover-first like Meta's own music app: big album art with a volume
 * ring, round controls, and a row of covers to pick something else.
 * Playback runs on your phone (Premium); audio comes through the glasses.
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
    const picks = (s.picks ?? []).slice(0, 4);
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
                 <div class="small muted">${icon('music', 14)} ${esc(t.device ?? '')} · vol <span class="v">${t.volume ?? '—'}</span></div>`
              : ''
          }
        </div>
      </div>
      <div class="row" style="justify-content:center;gap:14px">
        ${btn('vdown', '', { cls: 'round', icon: 'minus' })}
        ${btn('prev', '', { cls: 'round', icon: 'prev' })}
        ${btn('toggle', '', { cls: 'round main', icon: t?.playing ? 'pause' : 'play', def: true })}
        ${btn('next', '', { cls: 'round', icon: 'next' })}
        ${btn('vup', '', { cls: 'round', icon: 'plus' })}
      </div>
      <div class="picks">${picks.map((p, i) => `<button class="pick" data-f="p:${i}" title="${esc(p.title)}">${art(p.art, p.title, 102)}</button>`).join('')}<button class="pick pl-tile" data-f="playlists">${icon('music', 30, C.green)}<span class="small">playlists</span><span class="small muted">${s.playlists?.length ?? 0}</span></button></div>
    </main>
    ${footer('pinch-twist also sets volume · ↓ to pick a cover')}`;
  },
  mount(root) {
    const t = store.state?.track;
    const vol = t?.volume ?? 50;
    on(root, 'toggle', () => send({ t: 'spotify', action: t?.playing ? 'pause' : 'play' }));
    on(root, 'prev', () => send({ t: 'spotify', action: 'prev' }));
    on(root, 'next', () => send({ t: 'spotify', action: 'next' }));
    on(root, 'vdown', () => send({ t: 'spotify', action: 'volume', value: vol - 10 }));
    on(root, 'vup', () => send({ t: 'spotify', action: 'volume', value: vol + 10 }));
    onEach(root, 'p:', (i) => {
      const p = store.state?.picks[Number(i)];
      if (p) send({ t: 'spotify', action: 'playUri', value: p.uri });
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
    onEach(root, 'pl:', (i) => {
      const p = store.state?.playlists[Number(i)];
      if (!p) return;
      send({ t: 'spotify', action: 'playUri', value: p.uri });
      back();
    });
  },
});
