import type { ClientMsg, RouteInfo, ServerMsg, ShellState, StatusReport } from '../../shared/protocol.ts';

/**
 * Connection to the relay plus the latest state snapshot.
 * The relay sends a full snapshot on every change (it's small), so the app
 * never patches state by hand: it just re-renders.
 */

const TOKEN_KEY = 'shell.k';

function readToken(): string | null {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('k');
  if (fromUrl) {
    try {
      localStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      /* storage can fail on the glasses; we still have it for this run */
    }
    url.searchParams.delete('k');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    return fromUrl;
  }
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export const token = readToken();

type Listener = () => void;
const listeners = new Set<Listener>();

export const store = {
  state: null as ShellState | null,
  connected: false,
  lastError: '' as string,
  report: null as StatusReport | null,
  route: null as RouteInfo | null,
  routeError: '' as string,
  /** Server clock minus ours, so "5m ago" is right even if the glasses clock drifts. */
  skew: 0,
  on(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit() {
    for (const fn of listeners) fn();
  },
};

export const now = () => Date.now() + store.skew;

// ---------- one-off event hooks (toasts, cards, dictation replies) ----------
type Hook = (m: ServerMsg) => void;
const hooks = new Set<Hook>();
export const onMessage = (fn: Hook) => {
  hooks.add(fn);
  return () => hooks.delete(fn);
};

// ---------- socket ----------
let ws: WebSocket | null = null;
let retry = 0;
const queue: string[] = [];

export function connect() {
  if (!token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?k=${encodeURIComponent(token)}`);
  ws.onopen = () => {
    retry = 0;
    store.connected = true;
    while (queue.length) ws!.send(queue.shift()!);
    store.emit();
  };
  ws.onclose = () => {
    store.connected = false;
    store.emit();
    const wait = Math.min(15_000, 500 * 2 ** retry++);
    setTimeout(connect, wait);
  };
  ws.onerror = () => ws?.close();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMsg;
    if (msg.t === 'state') {
      store.state = msg.state;
      store.skew = msg.state.serverTime - Date.now();
    } else if (msg.t === 'status.report') {
      store.report = msg.report;
    } else if (msg.t === 'route.result') {
      store.route = msg.route;
      store.routeError = msg.error ?? '';
    } else if (msg.t === 'error') {
      store.lastError = msg.text;
    }
    for (const h of hooks) h(msg);
    store.emit();
  };
}

export function send(msg: ClientMsg) {
  const data = JSON.stringify(msg);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  else queue.push(data);
}

/** Ask the relay to clean dictated text; resolves with the cleaned text. */
export function clean(text: string, context?: string): Promise<string> {
  const reqId = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve(text);
    }, 9000);
    const off = onMessage((m) => {
      if (m.t === 'dictation.cleaned' && m.reqId === reqId) {
        clearTimeout(timer);
        off();
        resolve(m.text);
      }
    });
    send({ t: 'dictation.clean', reqId, text, context });
  });
}

// ---------- device: glasses battery (documented API) ----------
export const device = { battery: null as number | null, charging: false };

(async () => {
  const nav = navigator as Navigator & { getBattery?: () => Promise<any> };
  if (!nav.getBattery) return;
  try {
    const b = await nav.getBattery();
    const read = () => {
      device.battery = Math.round(b.level * 100);
      device.charging = Boolean(b.charging);
      store.emit();
    };
    read();
    b.addEventListener('levelchange', read);
    b.addEventListener('chargingchange', read);
  } catch {
    /* not available */
  }
})();
