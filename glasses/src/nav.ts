/**
 * Input + routing for the lens.
 *
 * The glasses turn Neural Band / temple gestures into keyboard events:
 *   swipe → ArrowUp/Down/Left/Right   index pinch → Enter   middle tap → back (Escape / history)
 * We move focus ourselves (spatial nav) so behaviour is identical in the
 * simulator, a desktop browser and on the glasses.
 */

export interface Screen<P = any> {
  render(p: P): string;
  /** Called after each render, with the screen root. */
  mount?(root: HTMLElement, p: P): void;
  /** Return true if the screen handled the key itself. */
  key?(e: KeyboardEvent, p: P): boolean;
}

interface Entry {
  name: string;
  params: any;
}

const screens = new Map<string, Screen>();
let current: Entry = { name: 'home', params: {} };
let rerender: () => void = () => {};

export const register = (name: string, s: Screen) => screens.set(name, s);
/** A screen shown over everything (the app lock). Keys go to it; back does nothing. */
let override: string | null = null;
export const setOverride = (name: string | null) => (override = name);
export const currentScreen = () => current;
export const screenFor = (name: string) => screens.get(name);
export const onNavigate = (fn: () => void) => (rerender = fn);

export function go(name: string, params: any = {}) {
  // Remember where focus was, so Back lands on the same control.
  history.replaceState({ ...current, focus: lastFocus }, '', location.hash);
  current = { name, params };
  history.pushState(current, '', `#${name}`);
  lastFocus = null;
  arrived = true;
  rerender();
}

export function replace(name: string, params: any = {}) {
  current = { name, params };
  history.replaceState(current, '', `#${name}`);
  lastFocus = null;
  arrived = true;
  rerender();
}

export function back() {
  if (current.name === 'home') return;
  history.back();
}

window.addEventListener('popstate', (e) => {
  const st = (e.state as (Entry & { focus?: string | null }) | null) ?? { name: 'home', params: {} };
  current = { name: st.name, params: st.params };
  lastFocus = st.focus ?? null;
  rerender();
});

export function initHistory() {
  history.replaceState({ name: 'home', params: {} }, '', '#home');
}

// ---------- focus ----------
let lastFocus: string | null = null;
/** True for the first render after go()/replace(), so a screen can set itself up once per visit. */
let arrived = true;
export const justArrived = () => arrived;

const focusables = (root: ParentNode = document) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-f]')).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );

/** After a render: put focus back on the same control (by data-f key), else the first one. */
export function restoreFocus(root: HTMLElement) {
  const all = focusables(root);
  const keep = lastFocus ? all.find((el) => el.dataset.f === lastFocus) : null;
  const target = keep ?? all.find((el) => el.hasAttribute('data-default')) ?? all[0];
  target?.focus({ preventScroll: true });
  // Bring it into view, unless it's a control taller than the view that's already partly showing
  // (you're scrolling through it; jumping to its top would lose your place).
  const view = target?.closest<HTMLElement>('main.scroll')?.getBoundingClientRect();
  const r = target?.getBoundingClientRect();
  const partlyShown = view && r && r.height > view.height && r.bottom > view.top + 4 && r.top < view.bottom - 4;
  if (!partlyShown) target?.scrollIntoView({ block: 'nearest' });
  arrived = false;
}

document.addEventListener('focusin', (e) => {
  const el = e.target as HTMLElement;
  if (el?.dataset?.f) lastFocus = el.dataset.f;
});

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Pick the nearest control in a direction, favouring ones that line up. */
function move(dir: 'up' | 'down' | 'left' | 'right') {
  const all = focusables();
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !all.includes(cur)) {
    all[0]?.focus();
    return;
  }
  const a = cur.getBoundingClientRect();
  // A control taller than the view (a long message): up/down first scroll through it, and move on
  // only once its edge is in view.
  const view = cur.closest<HTMLElement>('main.scroll');
  if (view && (dir === 'up' || dir === 'down')) {
    const m = view.getBoundingClientRect();
    const step = Math.round(m.height * 0.6);
    if (dir === 'down' && a.bottom > m.bottom + 2) return view.scrollBy({ top: Math.min(step, a.bottom - m.bottom + 12), behavior: 'smooth' });
    if (dir === 'up' && a.top < m.top - 2) return view.scrollBy({ top: -Math.min(step, m.top - a.top + 12), behavior: 'smooth' });
  }
  const ca = center(a);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const cb = center(b);
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    let primary: number, cross: number, overlap: boolean;
    if (dir === 'down') [primary, cross, overlap] = [b.top - a.bottom + 1, dx, b.left < a.right && b.right > a.left];
    else if (dir === 'up') [primary, cross, overlap] = [a.top - b.bottom + 1, dx, b.left < a.right && b.right > a.left];
    else if (dir === 'right') [primary, cross, overlap] = [b.left - a.right + 1, dy, b.top < a.bottom && b.bottom > a.top];
    else [primary, cross, overlap] = [a.left - b.right + 1, dy, b.top < a.bottom && b.bottom > a.top];
    if (primary < -4) continue; // wrong direction
    const score = Math.max(0, primary) + Math.abs(cross) * (overlap ? 0.3 : 2);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus({ preventScroll: true });
    // Back on the topmost control: scroll all the way up, so whatever sits above it (the home band,
    // a label) comes back into view too.
    const top = best.getBoundingClientRect().top;
    const main = best.closest<HTMLElement>('main.scroll');
    const b = best.getBoundingClientRect();
    const m = main?.getBoundingClientRect();
    if (main && dir === 'up' && all.every((el) => el.getBoundingClientRect().top >= top - 4)) main.scrollTo({ top: 0, behavior: 'smooth' });
    // Into a control taller than the view: show the edge you came in from (its end going up, its start going down).
    else if (main && m && b.height > m.height - 8 && (dir === 'up' || dir === 'down'))
      main.scrollBy({ top: dir === 'up' ? b.bottom - m.bottom + 8 : b.top - m.top - 8, behavior: 'smooth' });
    else best.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

const DIRS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function initKeys(onAnyKey: () => void) {
  document.addEventListener('keydown', (e) => {
    onAnyKey();
    const active = document.activeElement as HTMLElement | null;
    const typing = active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT';

    const screen = screens.get(override ?? current.name);
    if (!typing && screen?.key?.(e, override ? {} : current.params)) {
      e.preventDefault();
      return;
    }
    if (override && !typing && (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack')) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Backspace' && !typing || e.key === 'BrowserBack') {
      if (typing) active!.blur();
      else back();
      e.preventDefault();
      return;
    }
    if (DIRS[e.key] && !(typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
      e.preventDefault();
      move(DIRS[e.key]);
      return;
    }
    if (e.key === 'Enter' && active && active.dataset.f && active.tagName !== 'TEXTAREA') {
      e.preventDefault();
      active.click();
    }
  });
}
