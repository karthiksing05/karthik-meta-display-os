import { register, back, replace } from '../nav.ts';
import { store, send, onMessage } from '../store.ts';
import { C, esc, footer, header } from '../ui.ts';
import { clearComposer, composerBox, composerButtons, mountComposer } from './composer.ts';

/**
 * Full-screen composer, for a new session, a chat, or answering Claude's question in your own words.
 * Pick dictate (cleaned FreeFlow-style) or handwrite (sent as written); see composer.ts.
 */
type Target =
  | { kind: 'ask'; target: string; title: string }
  | { kind: 'session'; id: string; title: string }
  | { kind: 'new'; repo: string; title: string }
  | { kind: 'answer'; questionId: string; question: string; title: string }
  /** The notes tile: goes to the one notes session (Apple Notes); dictation starts right away. */
  | { kind: 'notes'; title: string; auto?: number };

const KEY = 'compose';
let forKey = '';
let open = false;
let autoFor = '';

function deliver(p: Target, text: string) {
  switch (p.kind) {
    case 'ask':
      send({ t: 'ask', target: p.target, text });
      break;
    case 'session':
      send({ t: 'session.send', id: p.id, text });
      break;
    case 'new':
      send({ t: 'session.start', repo: p.repo, prompt: text });
      open = false;
      replace('sessions');
      return;
    case 'answer':
      send({ t: 'question.answer', id: p.questionId, answers: { [p.question]: text } });
      break;
    case 'notes': {
      // Open the notes session to watch the reply (its id comes back; it's new the first time).
      const off = onMessage((m) => {
        if (m.t !== 'notes.opened') return;
        off();
        replace('session', { id: m.id });
      });
      setTimeout(off, 15_000);
      send({ t: 'notes.ask', text });
      open = false;
      return;
    }
  }
  open = false;
  back();
}

register('compose', {
  render(p: Target) {
    const key = JSON.stringify(p);
    if (key !== forKey) {
      forKey = key;
      open = false;
      clearComposer(KEY);
    }
    const notesLast = p.kind === 'notes' ? store.state?.sessions.find((x) => x.notes)?.transcript.filter((t) => t.role === 'claude').at(-1) : undefined;
    const context =
      p.kind === 'answer'
        ? `<div class="card small"><span class="label">question</span><br>${esc(p.question)}</div>`
        : p.kind === 'notes'
          ? `<div class="card small"><span class="label">notes · apple notes, synced to your phone</span>${
              notesLast ? `<span class="muted clamp6">last: ${esc(notesLast.text)}</span>` : 'Say what to add, change or tick off. Claude reads your to-do list and tidies it.'
            }</div>`
          : '';
    return `${header(p.title, C.pink)}
    <main>
      ${context}
      ${open ? composerBox(KEY) : `<div class="btns">${composerButtons(KEY, { def: true })}</div>`}
    </main>
    ${footer(open ? 'pinch the box · back cancels' : 'dictate is cleaned for you · handwrite is sent as written')}`;
  },
  key(e) {
    if (e.key === 'Escape' && open) {
      open = false;
      clearComposer(KEY);
      store.emit();
      return true;
    }
    return false;
  },
  mount(root, p: Target) {
    let sent = false;
    // The notes tile starts dictating straight away (once per visit).
    if (p.kind === 'notes' && p.auto && !open && autoFor !== forKey) {
      autoFor = forKey;
      queueMicrotask(() => root.querySelector<HTMLElement>(`[data-f="${KEY}:dictate"]`)?.click());
    }
    mountComposer(
      root,
      KEY,
      (text) => {
        sent = true;
        deliver(p, text);
      },
      () => {
        open = true;
        store.emit();
      },
      () => {
        if (sent) return;
        open = false;
        store.emit();
      },
    );
  },
});
