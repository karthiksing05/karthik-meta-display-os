import { store, clean } from '../store.ts';
import { btn, esc } from '../ui.ts';

/**
 * A text box that lives on the current screen (no separate page), opened in one of two modes:
 *
 *  - dictate: you speak; the relay always cleans it FreeFlow-style (Groq: filler words out,
 *    self-corrections applied, code terms formatted). You send the cleaned text, or "as spoken".
 *  - handwrite: you write (or type); it's sent exactly as written, no cleanup.
 *
 * Either button opens the box and puts you straight into the glasses' own text input. One box per
 * `key` (= the textarea's data-f).
 */
export type Mode = 'dictate' | 'write';
const drafts = new Map<string, { raw: string; cleaned: string; busy: boolean; mode: Mode }>();
const draft = (key: string) => drafts.get(key) ?? (drafts.set(key, { raw: '', cleaned: '', busy: false, mode: 'dictate' }), drafts.get(key)!);

/** The two buttons that open the box: dictate (default) and handwrite. */
export function composerButtons(key: string, opts: { def?: boolean; dictate?: string; write?: string } = {}) {
  return (
    btn(`${key}:dictate`, opts.dictate ?? 'dictate', { icon: 'mic', def: opts.def, cls: 'primary' }) +
    btn(`${key}:write`, opts.write ?? 'handwrite', { icon: 'pen' })
  );
}

export function composerBox(key: string, to?: string) {
  const d = draft(key);
  const showClean = d.mode === 'dictate' && d.cleaned && d.cleaned !== d.raw;
  const hint = d.mode === 'dictate' ? `pinch, then speak${to ? ` to ${to}` : ''} · cleaned for you` : `pinch, then write${to ? ` to ${to}` : ''} · sent as written`;
  return `<div class="inline-compose col">
    <textarea data-f="${esc(key)}" data-default placeholder="${esc(hint)}">${esc(d.raw)}</textarea>
    ${showClean ? `<div class="card"><div class="label">cleaned</div><div>${esc(d.cleaned)}</div></div>` : d.busy ? '<div class="muted small">cleaning…</div>' : ''}
    <div class="btns">
      ${btn(`${key}:send`, 'send', { icon: 'send', cls: 'primary' })}
      ${showClean ? btn(`${key}:raw`, 'send as spoken') : ''}
      ${btn(`${key}:cancel`, 'cancel', { icon: 'x' })}
    </div>
  </div>`;
}

export function clearComposer(key: string) {
  drafts.delete(key);
}

/** Put the focus in the box and open the glasses' text input (they open it on a pinch = click). */
function enterBox(key: string) {
  requestAnimationFrame(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(`textarea[data-f="${CSS.escape(key)}"]`);
    if (!ta) return;
    ta.focus();
    ta.click();
  });
}

/**
 * Wire the buttons and the box. `open` shows the box, `close` hides it (send and cancel both call it),
 * `deliver` gets the text to send.
 */
export function mountComposer(root: HTMLElement, key: string, deliver: (text: string) => void, open: () => void, close: () => void) {
  const bind = (k: string, fn: () => void) => {
    const el = root.querySelector<HTMLElement>(`[data-f="${CSS.escape(k)}"]`);
    if (el) el.onclick = fn;
  };
  const start = (mode: Mode) => () => {
    const d = draft(key);
    d.mode = mode;
    d.cleaned = '';
    open();
    enterBox(key);
  };
  bind(`${key}:dictate`, start('dictate'));
  bind(`${key}:write`, start('write'));

  const ta = root.querySelector<HTMLTextAreaElement>(`textarea[data-f="${CSS.escape(key)}"]`);
  if (!ta) return;
  const d = draft(key);
  const finish = async () => {
    d.raw = ta.value;
    if (!d.raw.trim()) return;
    if (d.mode === 'dictate') {
      d.busy = true;
      store.emit();
      const ctx = (store.state?.sessions ?? []).map((s) => `${s.name} (${s.repo})`).join(', ');
      d.cleaned = await clean(d.raw, ctx);
      d.busy = false;
    } else d.cleaned = d.raw;
    ta.blur();
    store.emit();
    root.querySelector<HTMLElement>(`[data-f="${CSS.escape(`${key}:send`)}"]`)?.focus();
  };
  ta.addEventListener('input', () => (d.raw = ta.value));
  ta.addEventListener('change', finish);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish();
    }
  });
  const fire = (text: string) => {
    if (!text.trim()) return;
    drafts.delete(key);
    deliver(text.trim());
    close();
  };
  bind(`${key}:send`, () => fire(d.cleaned || ta.value));
  bind(`${key}:raw`, () => fire(d.raw || ta.value));
  bind(`${key}:cancel`, () => {
    drafts.delete(key);
    close();
  });
}
