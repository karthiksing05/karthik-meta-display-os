import { register, back, replace } from '../nav.ts';
import { store, send } from '../store.ts';
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
  | { kind: 'answer'; questionId: string; question: string; title: string };

const KEY = 'compose';
let forKey = '';
let open = false;

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
    const context = p.kind === 'answer' ? `<div class="card small"><span class="label">question</span><br>${esc(p.question)}</div>` : '';
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
