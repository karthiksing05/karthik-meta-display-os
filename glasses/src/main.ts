import './styles.css';
import { connect, onMessage, reloadApp, store, token } from './store.ts';
import { currentScreen, initHistory, initKeys, onNavigate, restoreFocus, screenFor, go, setOverride } from './nav.ts';
import { wake } from './pixels.ts';
import { BRAND, esc, header, footer, C } from './ui.ts';
import './screens/home.ts';
import './screens/claude.ts';
import './screens/compose.ts';
import './screens/settings.ts';
import './screens/twofa.ts';
import './screens/lock.ts';

const app = document.getElementById('app')!;
const overlay = document.getElementById('overlay')!;

let queued = false;
let lastShown = '';
function render() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    // Don't rebuild the page while the composer is open: it would drop the text.
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return;
    if (store.stale) return reloadApp();

    document.body.classList.toggle('black', store.state?.settings.background === 'black');
    const { name, params } = currentScreen();
    const screen = screenFor(name) ?? screenFor('home')!;
    if (!token) {
      app.innerHTML = `${header(BRAND)}<main class="center"><div>
        <div class="y">No relay token.</div>
        <div class="small muted">Install the app from your relay's /install page<br>(or open this URL with ?k=YOUR_TOKEN once).</div>
      </div></main>${footer('see docs/PUSH_TO_GLASSES.md')}`;
      return;
    }
    // App lock: the lock screen covers everything until the relay accepts the pattern/password.
    if (store.locked) {
      setOverride('lock');
      const lock = screenFor('lock')!;
      app.innerHTML = lock.render({});
      lock.mount?.(app, {});
      restoreFocus(app);
      return;
    }
    setOverride(null);
    // Same screen re-rendered with new data: keep where it was scrolled to.
    const shown = `${name}|${JSON.stringify(params)}`;
    const keepTop = shown === lastShown ? app.querySelector<HTMLElement>('main.scroll')?.scrollTop : undefined;
    app.innerHTML = screen.render(params);
    screen.mount?.(app, params);
    if (keepTop != null) {
      const m = app.querySelector<HTMLElement>('main.scroll');
      if (m) m.scrollTop = keepTop;
    }
    lastShown = shown;
    restoreFocus(app);
  });
}

// ---------- toasts: agent notifications, cards and errors ----------
function toast(html: string, level = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${level}`;
  el.innerHTML = html;
  overlay.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

onMessage((m) => {
  if (m.t === 'notify') toast(esc(m.text), m.level);
  if (m.t === 'card') toast(`<div class="y">${esc(m.title)}</div><div class="small">${esc(m.body).replace(/\n/g, '<br>')}</div>`, 'info', 9000);
  if (m.t === 'error') toast(esc(m.text), 'error', 6000);
  if (m.t === 'status.report' && !store.statusCancelled && currentScreen().name !== 'report') go('report');
});

// Refresh relative times ("5m") once a minute even without new data.
setInterval(render, 30_000);

initHistory();
onNavigate(render);
initKeys(wake);
store.on(render);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    wake();
    render();
  }
});
connect();
render();
