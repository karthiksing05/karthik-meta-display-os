import { store, clean } from '../store.ts';
import { btn, esc } from '../ui.ts';

/**
 * A text box that lives on the current screen (no separate page). Focusing the box opens the
 * glasses' own text input (dictation, handwriting, keyboard); when you finish, the relay cleans the
 * text and you send the clean or the spoken version. One box per `key` (= the textarea's data-f),
 * so give the button that opens it the same key and focus lands straight in the box.
 */
const drafts = new Map<string, { raw: string; cleaned: string; busy: boolean; dictate?: boolean }>();
const draft = (key: string) => drafts.get(key) ?? (drafts.set(key, { raw: '', cleaned: '', busy: false }), drafts.get(key)!);

/**
 * The "dictate" button: open the box for `key` (via `open`), always clean the result FreeFlow-style
 * (whatever the dictation cleanup setting says), and put you straight into the glasses' text input
 * instead of waiting for a pinch on the box.
 */
export function startDictation(key: string, open: () => void) {
  draft(key).dictate = true;
  open();
  requestAnimationFrame(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(`textarea[data-f="${CSS.escape(key)}"]`);
    if (!ta) return;
    ta.focus();
    ta.click(); // the glasses open their composer on a pinch (click) on a text box
  });
}

export function composerBox(key: string, placeholder = 'pinch here, then dictate or handwrite') {
  const d = draft(key);
  const showClean = d.cleaned && d.cleaned !== d.raw;
  return `<div class="inline-compose col">
    <textarea data-f="${esc(key)}" data-default placeholder="${esc(placeholder)}">${esc(d.raw)}</textarea>
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

/** Wire the box. `deliver` gets the text to send; `close` hides the box (send and cancel both call it). */
export function mountComposer(root: HTMLElement, key: string, deliver: (text: string) => void, close: () => void) {
  const ta = root.querySelector<HTMLTextAreaElement>(`textarea[data-f="${CSS.escape(key)}"]`);
  if (!ta) return;
  const d = draft(key);
  const finish = async () => {
    d.raw = ta.value;
    if (!d.raw.trim()) return;
    if (d.dictate || (store.state?.settings.dictationCleanup ?? true)) {
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
  const bind = (k: string, fn: () => void) => {
    const el = root.querySelector<HTMLElement>(`[data-f="${CSS.escape(k)}"]`);
    if (el) el.onclick = fn;
  };
  bind(`${key}:send`, () => fire(d.cleaned || ta.value));
  bind(`${key}:raw`, () => fire(d.raw || ta.value));
  bind(`${key}:cancel`, () => {
    drafts.delete(key);
    close();
  });
}
