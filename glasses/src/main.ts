import './styles.css';
import { connect, onMessage, store, token } from './store.ts';
import { currentScreen, initHistory, initKeys, onNavigate, restoreFocus, screenFor, go } from './nav.ts';
import { wake } from './pixels.ts';
import { esc, header, footer, C } from './ui.ts';
import './screens/home.ts';
import './screens/claude.ts';
import './screens/compose.ts';
import './screens/comms.ts';
import './screens/spotify.ts';
import './screens/day.ts';
import './screens/settings.ts';
import './screens/photos.ts';
import './screens/twofa.ts';

const app = document.getElementById('app')!;
const overlay = document.getElementById('overlay')!;

let queued = false;
function render() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    // Don't rebuild the page while the composer is open: it would drop the text.
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return;

    document.body.classList.toggle('black', store.state?.settings.background === 'black');
    const { name, params } = currentScreen();
    const screen = screenFor(name) ?? screenFor('home')!;
    if (!token) {
      app.innerHTML = `${header('claude shell', C.pink)}<main class="center"><div>
        <div class="y">No relay token.</div>
        <div class="small muted">Install the app from your relay's /install page<br>(or open this URL with ?k=YOUR_TOKEN once).</div>
      </div></main>${footer('see docs/PUSH_TO_GLASSES.md')}`;
      return;
    }
    app.innerHTML = screen.render(params);
    screen.mount?.(app, params);
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
  if (m.t === 'status.report' && currentScreen().name !== 'claude') go('claude');
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
