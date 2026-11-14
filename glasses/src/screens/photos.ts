import { register, go } from '../nav.ts';
import { store, send, onMessage, token } from '../store.ts';
import { C, btn, clock, esc, footer, header, icon } from '../ui.ts';
import { on, onEach } from './util.ts';
import type { PhotoItem } from '../../../shared/protocol.ts';

/**
 * Photo library on the lens: a grid of thumbnails, search by dictation, and a
 * full-screen viewer you swipe through. Photos come from the relay (your Mac's
 * Photos library via osxphotos, or a folder). Glasses captures land there too:
 * the Meta AI app imports them into the iPhone's Photos ("Meta AI" album),
 * iCloud syncs them to the Mac, and the "from glasses" chip filters to them.
 */
const view = { q: '', items: [] as PhotoItem[], total: 0, loading: false, error: '' };

export function searchPhotos(q: string, offset = 0) {
  view.q = q;
  view.loading = true;
  if (!offset) view.items = [];
  send({ t: 'photos.query', q, offset });
  store.emit();
}

onMessage((m) => {
  if (m.t !== 'photos.result' || m.q !== view.q) return;
  view.items = m.offset ? [...view.items, ...m.items] : m.items;
  view.total = m.total;
  view.error = m.error ?? '';
  view.loading = false;
});

const src = (id: string, size: 'thumb' | 'full') => `/api/photos/img/${encodeURIComponent(id)}?size=${size}&k=${encodeURIComponent(token ?? '')}`;
const day = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

const CHIPS: [string, string][] = [
  ['recent', ''],
  ['favorites', 'favorites'],
  ['from glasses', 'meta ai'],
];

register('photos', {
  render() {
    const chip = (label: string, q: string) => btn(`q:${q}`, label, { cls: `chip ${view.q === q ? 'primary' : ''}` });
    const custom = view.q && !CHIPS.some(([, q]) => q === view.q);
    return `${header('photos', C.cyan)}
    <main class="scroll">
      <div class="seg">${btn('search', 'search', { icon: 'mic', cls: 'chip' })}${CHIPS.map(([l, q]) => chip(l, q)).join('')}${custom ? chip(`“${esc(view.q)}”`, view.q) : ''}</div>
      ${view.error ? `<div class="p small">${esc(view.error)}</div>` : ''}
      <div class="grid">${view.items
        .map((p, i) => `<button class="thumb" data-f="p:${i}"><img src="${src(p.id, 'thumb')}" alt="" loading="lazy">${p.favorite ? '<i class="fav">♥</i>' : ''}</button>`)
        .join('')}</div>
      ${view.loading ? '<div class="muted small">loading…</div>' : !view.items.length && !view.error ? '<div class="muted center">No photos match.</div>' : ''}
      ${view.items.length < view.total ? btn('more', `more (${view.total - view.items.length})`, { cls: 'wide' }) : ''}
    </main>
    ${footer(`${view.total} photo${view.total === 1 ? '' : 's'} · pinch to open · search by voice`)}`;
  },
  mount(root) {
    if (!view.items.length && !view.loading && !view.error) searchPhotos(view.q);
    on(root, 'search', () => go('compose', { kind: 'photos', title: 'find photos' }));
    onEach(root, 'q:', (q) => searchPhotos(q));
    onEach(root, 'p:', (i) => go('photo', { i: Number(i) }));
    on(root, 'more', () => searchPhotos(view.q, view.items.length));
  },
});

register('photo', {
  render({ i }) {
    const p = view.items[i];
    if (!p) return `${header('photo')}<main class="center muted">Gone.</main>`;
    return `<div class="viewer">
      <img src="${src(p.id, 'full')}" alt="">
      <div class="caption"><span class="y">${esc(p.place ?? p.title)}</span><span class="muted">${day(p.date)} · ${clock(p.date)}</span><span class="v">${i + 1}/${view.total}</span></div>
      <button data-f="hold" data-default class="ghost" aria-label="photo"></button>
    </div>`;
  },
  key(e, p) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return false;
    const next = Math.max(0, Math.min(view.items.length - 1, p.i + step));
    if (next >= view.items.length - 3 && view.items.length < view.total && !view.loading) searchPhotos(view.q, view.items.length);
    p.i = next;
    history.replaceState({ name: 'photo', params: p }, '', '#photo');
    store.emit();
    return true;
  },
});

export { icon };
