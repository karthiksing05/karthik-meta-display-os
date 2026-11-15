/**
 * What's new on screen, for the arrival animations. Screens re-render from scratch on every update,
 * so a CSS animation would restart each time; instead each item remembers when it first appeared
 * (or last changed) and gets a negative animation-delay, so it carries on where it was.
 *
 * The first time a scope (a session's feed, a conversation) is shown, everything already there counts
 * as old: only what arrives while you watch animates.
 */
const seen = new Map<string, { t: number; sig: string; kind: 'new' | 'upd' }>();
const primed = new Set<string>();
const LIFE = 1600; // ms an item counts as fresh (longest animation)

export type Fresh = { cls: string; style: string };
const none: Fresh = { cls: '', style: '' };

/** Call once per render with every key in the scope, before asking about any of them. */
export function prime(scope: string, items: { key: string; sig: string }[]) {
  if (primed.has(scope)) return;
  primed.add(scope);
  for (const it of items) seen.set(`${scope}|${it.key}`, { t: 0, sig: it.sig, kind: 'new' });
}

/** fx-new = just arrived (grows in, bumping older ones up, and flashes); fx-upd = its text changed (flashes). */
export function fresh(scope: string, key: string, sig: string): Fresh {
  const k = `${scope}|${key}`;
  const now = Date.now();
  let s = seen.get(k);
  if (!s) seen.set(k, (s = { t: now, sig, kind: 'new' }));
  else if (s.sig !== sig) {
    const stillGrowing = s.kind === 'new' && s.t && now - s.t < 450;
    s.sig = sig;
    if (!stillGrowing) (s.t = now), (s.kind = 'upd');
  }
  const age = now - s.t;
  if (!s.t || age > LIFE) return none;
  return { cls: s.kind === 'upd' ? 'fx-upd' : 'fx-new', style: `animation-delay:-${age}ms,-${age}ms` };
}

/** A looping animation (dots, shimmer) that keeps its phase across re-renders. */
export const phase = (period: number) => `animation-delay:-${Date.now() % period}ms`;
