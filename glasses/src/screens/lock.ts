import { register } from '../nav.ts';
import { store, send } from '../store.ts';
import { BRAND, C, esc, footer, header, icon } from '../ui.ts';

/**
 * App lock screen (relay has APP_PATTERN or APP_PASSWORD set). Nothing else is reachable until the
 * relay accepts the pattern or password; it then gives this device a pass for APP_LOCK_HOURS.
 *   pattern:  swipe the moves, pinch to submit, back clears
 *   password: pinch the box, then dictate, handwrite or type it
 */
let seq: string[] = [];
const ARROW: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const GLYPH: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };

register('lock', {
  render() {
    const l = store.locked;
    const msg = l?.reason ? `${l.reason}${l.triesLeft != null ? ` · ${l.triesLeft} tries left` : ''}` : '';
    if (l?.method === 'password') {
      return `${header(BRAND)}
      <main class="center"><div style="width:100%">
        <div>${icon('key', 44, C.purple)}</div>
        <div style="margin:8px 0">Locked</div>
        <textarea data-f="pw" data-default placeholder="pinch, then say or write your password" style="min-height:48px"></textarea>
        <div class="small ${msg ? 'p' : 'muted'}" style="margin-top:8px">${esc(msg || 'your sessions stay hidden until you unlock')}</div>
      </div></main>
      ${footer('pinch the box to enter your password')}`;
    }
    return `${header(BRAND)}
    <main class="center"><div>
      <div>${icon('key', 44, C.purple)}</div>
      <div>Swipe your pattern to unlock</div>
      <div class="pattern">${seq.map((d) => `<span>${GLYPH[d]}</span>`).join('') || '<span class="muted">·</span>'}</div>
      <div class="small ${msg ? 'p' : 'muted'}">${esc(msg || 'pinch to unlock · back clears')}</div>
    </div></main>
    <button data-f="pad" data-default class="ghost" aria-label="pattern pad"></button>
    ${footer('your sessions stay hidden until you unlock')}`;
  },
  mount(root) {
    const ta = root.querySelector<HTMLTextAreaElement>('textarea[data-f="pw"]');
    if (!ta) return;
    const submit = () => {
      const password = ta.value.trim();
      if (!password) return;
      ta.value = '';
      ta.blur();
      send({ t: 'app.unlock', password });
    };
    ta.addEventListener('change', submit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
  },
  key(e) {
    if (store.locked?.method === 'password') return false;
    const d = ARROW[e.key];
    if (d) {
      seq = [...seq, d].slice(-16);
      if (store.locked) store.locked.reason = undefined;
      store.emit();
      return true;
    }
    if (e.key === 'Enter') {
      if (seq.length) send({ t: 'app.unlock', pattern: seq });
      seq = [];
      store.emit();
      return true;
    }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      seq = [];
      store.emit();
      return true;
    }
    return false;
  },
});
