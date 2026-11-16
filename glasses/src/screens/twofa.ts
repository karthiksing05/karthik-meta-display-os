import { register } from '../nav.ts';
import { store, send, onMessage } from '../store.ts';
import { C, esc, footer, header, icon } from '../ui.ts';
import type { TotpCode } from '../../../shared/protocol.ts';

/**
 * 2FA codes (opt-in, see docs/TWO_FACTOR.md). Locked until you swipe your
 * unlock pattern; then codes show for 60 s and lock again. Codes are never in
 * the shared state: the relay sends them only to this screen, on request.
 */
const s = { seq: [] as string[], codes: [] as TotpCode[], until: 0, msg: '' };
let ticker: number | undefined;

onMessage((m) => {
  if (m.t === 'totp.codes') {
    s.codes = m.codes;
    s.until = m.unlockedUntil;
    s.msg = '';
  }
  if (m.t === 'totp.locked') {
    s.codes = [];
    s.until = 0;
    s.seq = [];
    s.msg = m.reason ? `${m.reason}${m.triesLeft != null ? ` · ${m.triesLeft} tries left` : ''}` : '';
  }
});

const ARROW: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const GLYPH: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };

function startTicker() {
  clearInterval(ticker);
  ticker = window.setInterval(() => {
    if (location.hash !== '#twofa') return clearInterval(ticker);
    if (s.until && Date.now() + 0 > s.until) {
      send({ t: 'totp.lock' });
      return;
    }
    if (s.until) send({ t: 'totp.list' }); // fresh codes + countdowns
  }, 1000);
}

register('twofa', {
  render() {
    // No word from the relay yet (offline, or it's restarting): say so, rather than "not set up".
    if (!store.state || !store.connected) {
      return `${header('2fa codes', C.purple)}<main class="center"><div>${icon('wifioff', 40, C.orange)}<div>Can't reach your Mac.</div><div class="small muted">Codes come from the relay. It reconnects by itself; try again in a moment.</div></div></main>${footer('back')}`;
    }
    if (!store.state.integrations.totp) {
      return `${header('2fa codes', C.purple)}<main class="center"><div>${icon('ask', 40, C.purple)}<div>2FA isn't set up.</div><div class="small muted">Opt-in. Read docs/TWO_FACTOR.md first.</div></div></main>${footer('back')}`;
    }
    if (!s.codes.length) {
      return `${header('2fa codes', C.purple)}
      <main class="center"><div>
        <div style="font-size:40px">${icon('ask', 44, C.purple)}</div>
        <div>Swipe your unlock pattern</div>
        <div class="pattern">${s.seq.map((d) => `<span>${GLYPH[d]}</span>`).join('') || '<span class="muted">·</span>'}</div>
        <div class="small ${s.msg ? 'p' : 'muted'}">${esc(s.msg || 'pinch to submit · back to cancel')}</div>
      </div></main>
      <button data-f="pad" data-default class="ghost" aria-label="pattern pad"></button>
      ${footer('codes show for 60 s, then lock')}`;
    }
    const left = Math.max(0, Math.ceil((s.until - Date.now()) / 1000));
    return `${header(`2fa · ${left}s`, C.purple)}
    <main class="scroll">
      <div class="list">${s.codes
        .map(
          // Each code is focusable (same key every second), so swiping scrolls and focus stays put.
          (c, i) => `<div class="item" data-f="code:${esc(c.id)}" tabindex="-1" ${i === 0 ? 'data-default' : ''}><span class="grow"><span class="y" style="display:block">${esc(c.issuer)}</span><span class="small muted">${esc(c.account)}</span></span>
            <span class="code ${c.remaining <= 5 ? 'p' : 'g'}">${c.code.slice(0, c.code.length / 2)} ${c.code.slice(c.code.length / 2)}</span>
            <span class="small muted" style="width:28px;text-align:right">${c.remaining}s</span></div>`,
        )
        .join('')}</div>
    </main>
    ${footer('swipe to scroll · back locks')}`;
  },
  mount(root) {
    startTicker();
  },
  key(e) {
    if (s.codes.length) return false;
    const d = ARROW[e.key];
    if (d) {
      s.seq = [...s.seq, d].slice(-12);
      s.msg = '';
      store.emit();
      return true;
    }
    if (e.key === 'Enter' && s.seq.length) {
      send({ t: 'totp.unlock', seq: s.seq });
      s.seq = [];
      return true;
    }
    return false;
  },
});

// Leaving the screen locks immediately.
window.addEventListener('popstate', () => {
  if (location.hash !== '#twofa' && s.until) send({ t: 'totp.lock' });
});
