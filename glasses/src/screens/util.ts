/** Bind a click to the control with this data-f key. */
export function on(root: HTMLElement, key: string, fn: () => void) {
  const el = root.querySelector<HTMLElement>(`[data-f="${CSS.escape(key)}"]`);
  if (el) el.onclick = fn;
}

/** Bind clicks on every control whose key starts with `prefix`; fn gets the rest of the key. */
export function onEach(root: HTMLElement, prefix: string, fn: (rest: string) => void) {
  root.querySelectorAll<HTMLElement>('[data-f]').forEach((el) => {
    const k = el.dataset.f!;
    if (k.startsWith(prefix)) el.onclick = () => fn(k.slice(prefix.length));
  });
}
