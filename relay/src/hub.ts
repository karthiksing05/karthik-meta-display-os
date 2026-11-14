import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import type { Phrase, ServerMsg, ShellState, Settings } from '../../shared/protocol.ts';
import { load, save } from './store.ts';
import { config } from './config.ts';
import { readHost } from './host.ts';
import { lockEnabled } from './lock.ts';

const defaultSettings: Settings = {
  approvals: 'balanced',
  background: 'gray',
  dictationCleanup: true,
  syncToLaptop: true,
  learnedRules: [],
};

/**
 * Quick replies on the lens. Edit DATA_DIR/phrases.json (label = chip text, text = what Claude gets);
 * changes show up within a few seconds, no restart.
 */
const DEFAULT_PHRASES: Phrase[] = [
  { label: 'continue', text: 'Continue' },
  { label: 'lgtm', text: 'Looks good to me. Ensure we bring up questions thoughtfully as they arise' },
  { label: 'elaborate', text: "I don't get this. Can you expand / elaborate, contextualizing the verdict / information you just gave w.r.t. the broader project?" },
  { label: 'draft plan', text: "Can you draft a plan for me to review before you start implementing? Want to make sure everything's good" },
  { label: 'summarize', text: "Summarize everything that's been happening recently!" },
];
const PHRASES_FILE = path.join(config.dataDir, 'phrases.json');
if (!fs.existsSync(PHRASES_FILE)) save('phrases', DEFAULT_PHRASES);
function loadPhrases(): Phrase[] {
  const p = load<Phrase[]>('phrases', DEFAULT_PHRASES);
  return Array.isArray(p) ? p.filter((x) => x && typeof x.label === 'string' && typeof x.text === 'string') : DEFAULT_PHRASES;
}
let phrasesMtime = 0;

/** Single source of truth. Mutate, then call hub.changed(). */
export const state: ShellState = {
  sessions: [],
  approvals: [],
  questions: [],
  repos: [],
  phrases: loadPhrases(),
  settings: { ...defaultSettings, ...load<Partial<Settings>>('settings', {}) },
  integrations: {
    claude: config.claudeAvailable,
    groq: Boolean(config.groqKey),
    totp: false,
    appLock: lockEnabled(),
    demo: config.demo,
  },
  serverTime: Date.now(),
  host: { battery: null, charging: false, wifi: null },
  build: buildId(),
};

const clients = new Set<WebSocket>();
let timer: NodeJS.Timeout | null = null;

export const hub = {
  add(ws: WebSocket) {
    clients.add(ws);
    send(ws, { t: 'state', state: snapshot() });
  },
  remove(ws: WebSocket) {
    clients.delete(ws);
  },
  get connected() {
    return clients.size;
  },
  /** Coalesce bursts of changes into one snapshot every 150 ms. */
  changed() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      broadcast({ t: 'state', state: snapshot() });
    }, 150);
  },
  broadcast,
  saveSettings() {
    save('settings', state.settings);
  },
};

/** mtime of the built index.html: changes on every `vite build`, so the lens knows to reload. */
function buildId(): string {
  try {
    return String(Math.floor(fs.statSync(path.join(config.glassesDist, 'index.html')).mtimeMs));
  } catch {
    return '';
  }
}

// Watch for rebuilds (vite build --watch replaces dist/), and tell the glasses.
setInterval(() => {
  const b = buildId();
  if (b && b !== state.build) {
    state.build = b;
    hub.changed();
  }
  try {
    const m = fs.statSync(PHRASES_FILE).mtimeMs;
    if (phrasesMtime && m !== phrasesMtime) {
      state.phrases = loadPhrases();
      hub.changed();
    }
    phrasesMtime = m;
  } catch {}
}, 2000).unref();

// The Mac's battery + Wi-Fi, for the header on the lens.
async function pollHost() {
  const h = await readHost().catch(() => null);
  if (h && JSON.stringify(h) !== JSON.stringify(state.host)) {
    state.host = h;
    hub.changed();
  }
}
pollHost();
setInterval(pollHost, 30_000).unref();

function snapshot(): ShellState {
  state.serverTime = Date.now();
  return state;
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
}
