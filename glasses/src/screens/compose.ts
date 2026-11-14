import { register, back, replace } from '../nav.ts';
import { store, send, clean } from '../store.ts';
import { C, btn, esc, footer, header } from '../ui.ts';
import { on } from './util.ts';
import { searchPhotos } from './photos.ts';

/**
 * Composer: focusing the text box opens the glasses' own text input
 * (dictation, neural handwriting or keyboard). When you finish, the relay
 * cleans the text FreeFlow-style (Groq) and you send the clean or raw version.
 */
type Target =
  | { kind: 'ask'; target: string; title: string }
  | { kind: 'session'; id: string; title: string }
  | { kind: 'new'; repo: string; title: string }
  | { kind: 'answer'; questionId: string; question: string; title: string }
  | { kind: 'comms'; contactId: string; title: string }
  | { kind: 'photos'; title: string };

let raw = '';
let cleaned = '';
let busy = false;
let forKey = '';

function deliver(p: Target, text: string) {
  if (!text.trim()) return;
  switch (p.kind) {
    case 'ask':
      send({ t: 'ask', target: p.target, text });
      break;
    case 'session':
      send({ t: 'session.send', id: p.id, text });
      break;
    case 'new':
      send({ t: 'session.start', repo: p.repo, prompt: text });
      raw = cleaned = '';
      replace('sessions');
      return;
    case 'answer':
      send({ t: 'question.answer', id: p.questionId, answers: { [p.question]: text } });
      break;
    case 'comms':
      send({ t: 'comms.send', contactId: p.contactId, text });
      break;
    case 'photos':
      searchPhotos(text.replace(/[.!?]+$/, ''));
      break;
  }
  raw = cleaned = '';
  back();
}

register('compose', {
  render(p: Target) {
    const key = JSON.stringify(p);
    if (key !== forKey) {
      forKey = key;
      raw = cleaned = '';
    }
    const cleanup = store.state?.settings.dictationCleanup ?? true;
    const context = p.kind === 'answer' ? `<div class="card small"><span class="label">question</span><br>${esc(p.question)}</div>` : '';
    return `${header(p.title, C.pink)}
    <main>
      ${context}
      <textarea data-f="text" data-default placeholder="pinch here, then dictate or handwrite">${esc(raw)}</textarea>
      ${
        cleaned && cleaned !== raw
          ? `<div class="card"><div class="label">cleaned</div><div>${esc(cleaned)}</div></div>`
          : busy
            ? '<div class="muted small">cleaning…</div>'
            : ''
      }
      <div class="btns">
        ${btn('send', 'send', { icon: 'send', cls: 'primary' })}
        ${cleaned && cleaned !== raw ? btn('raw', 'send as spoken') : ''}
        ${btn('cancel', 'cancel', { icon: 'x' })}
      </div>
      ${!cleanup ? '<div class="small muted">cleanup is off (settings)</div>' : ''}
    </main>
    ${footer('pinch the box to talk · back cancels')}`;
  },
  mount(root, p: Target) {
    const ta = root.querySelector('textarea')!;
    const finish = async () => {
      raw = ta.value;
      if (!raw.trim()) return;
      if (store.state?.settings.dictationCleanup ?? true) {
        busy = true;
        store.emit();
        const ctx = (store.state?.sessions ?? []).map((s) => `${s.name} (${s.repo})`).join(', ');
        cleaned = await clean(raw, ctx);
        busy = false;
      } else cleaned = raw;
      ta.blur();
      store.emit();
      (root.querySelector('[data-f="send"]') as HTMLElement | null)?.focus();
    };
    ta.addEventListener('change', finish);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish();
      }
    });
    on(root, 'send', () => deliver(p, cleaned || ta.value));
    on(root, 'raw', () => deliver(p, raw));
    on(root, 'cancel', () => {
      raw = cleaned = '';
      back();
    });
  },
});
