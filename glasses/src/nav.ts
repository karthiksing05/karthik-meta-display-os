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
  rerender();
}

export function replace(name: string, params: any = {}) {
  current = { name, params };
  history.replaceState(current, '', `#${name}`);
  lastFocus = null;
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
  target?.scrollIntoView({ block: 'nearest' });
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
    best.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
