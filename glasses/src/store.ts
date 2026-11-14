import type { ClientMsg, ServerMsg, ShellState, StatusReport } from '../../shared/protocol.ts';

/**
 * Connection to the relay plus the latest state snapshot.
 * The relay sends a full snapshot on every change (it's small), so the app
 * never patches state by hand: it just re-renders.
 */

const TOKEN_KEY = 'shell.k';
/** App lock: the signed pass the relay gave this device when you unlocked. */
const PASS_KEY = 'shell.pass';
const getPass = () => {
  try {
    return localStorage.getItem(PASS_KEY) ?? '';
  } catch {
    return '';
  }
};
let memPass = '';

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
  /** Server clock minus ours, so "5m ago" is right even if the glasses clock drifts. */
  skew: 0,
  /** A newer build of this app is on the relay; main.ts reloads when it's safe. */
  stale: false,
  /** App lock: set while the relay wants the pattern/password. */
  locked: null as null | { method: 'pattern' | 'password'; reason?: string; triesLeft?: number },
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

/** Show a toast from the app itself (e.g. "sent: lgtm"), same look as relay notifications. */
export function localNotify(text: string, level: 'info' | 'good' | 'warn' | 'error' = 'good') {
  for (const h of hooks) h({ t: 'notify', text, level });
}

// ---------- socket ----------
let ws: WebSocket | null = null;
let firstBuild: string | null = null;
let retry = 0;
const queue: string[] = [];

export function connect() {
  if (!token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const pass = memPass || getPass();
  ws = new WebSocket(`${proto}://${location.host}/ws?k=${encodeURIComponent(token)}${pass ? `&s=${encodeURIComponent(pass)}` : ''}`);
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
    if (msg.t === 'app.locked') {
      store.locked = { method: msg.method, reason: msg.reason, triesLeft: msg.triesLeft };
    } else if (msg.t === 'app.unlocked') {
      store.locked = null;
      memPass = msg.pass;
      try {
        localStorage.setItem(PASS_KEY, msg.pass);
      } catch {
        /* kept in memory for this run */
      }
    } else if (msg.t === 'state') {
      store.locked = null;
      store.state = msg.state;
      store.skew = msg.state.serverTime - Date.now();
      // First build we see is the one we're running; a different one means the app was rebuilt.
      if (msg.state.build) {
        firstBuild ??= msg.state.build;
        if (msg.state.build !== firstBuild) store.stale = true;
      }
    } else if (msg.t === 'status.report') {
      store.report = msg.report;
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

/** Lock this device now: forget its pass and reconnect (the relay asks for the pattern again). */
export function lockNow() {
  memPass = '';
  try {
    localStorage.removeItem(PASS_KEY);
  } catch {}
  store.state = null;
  ws?.close();
}

/** Load the new build. Carries the token in the URL in case localStorage didn't keep it. */
export function reloadApp() {
  location.replace(location.pathname + (token ? `?k=${encodeURIComponent(token)}` : ''));
}
