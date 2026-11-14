import type { WebSocket } from 'ws';
import type { ServerMsg, ShellState, Settings } from '../../shared/protocol.ts';
import { load, save } from './store.ts';
import { config } from './config.ts';

const defaultSettings: Settings = {
  approvals: 'balanced',
  animation: 'wave',
  background: 'gray',
  dictationCleanup: true,
  learnedRules: [],
};

interface UserLists {
  bookmarks: ShellState['bookmarks'];
  favorites: ShellState['favorites'];
}

const lists = load<UserLists>('lists', {
  bookmarks: [
    { name: 'YouTube', url: 'https://m.youtube.com' },
    { name: 'X', url: 'https://x.com' },
    { name: 'LinkedIn', url: 'https://www.linkedin.com' },
    { name: 'Discord', url: 'https://discord.com/app' },
    { name: 'Hacker News', url: 'https://news.ycombinator.com' },
  ],
  favorites: [{ name: 'Home', address: '' }],
});
save('lists', lists);

/** Single source of truth. Mutate, then call hub.changed(). */
export const state: ShellState = {
  sessions: [],
  approvals: [],
  questions: [],
  repos: [],
  track: null,
  picks: [],
  agenda: [],
  mail: [],
  contacts: [],
  settings: { ...defaultSettings, ...load<Partial<Settings>>('settings', {}) },
  integrations: {
    claude: config.claudeAvailable,
    groq: Boolean(config.groqKey),
    spotify: false,
    google: Boolean(config.googleFeedUrl),
    maps: Boolean(config.mapsKey),
    messages: Boolean(config.bbUrl),
    photos: false,
    totp: false,
    demo: config.demo,
  },
  bookmarks: lists.bookmarks,
  favorites: lists.favorites,
  serverTime: Date.now(),
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
