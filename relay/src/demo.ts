import { randomUUID } from 'node:crypto';
import type { ClientMsg, SessionInfo } from '../../shared/protocol.ts';
import { hub, state } from './hub.ts';

/**
 * DEMO=1: fake sessions, approvals, questions, music, agenda and messages,
 * so you can try every screen in the simulator or on the glasses with no keys.
 */
const min = 60_000;
const now = () => Date.now();

function session(p: Partial<SessionInfo> & Pick<SessionInfo, 'name' | 'repo' | 'status' | 'activity'>): SessionInfo {
  return {
    id: randomUUID(),
    branch: `shell/${p.name.toLowerCase().replace(/\W+/g, '-')}`,
    startedAt: now() - 40 * min,
    lastActivity: now() - 2 * min,
    progress: null,
    todos: [],
    diffStat: { files: 0, added: 0, removed: 0 },
    transcript: [],
    costUsd: 0.42,
    ...p,
  };
}

export function startDemo() {
  const auth = session({
    name: 'auth refactor',
    repo: 'webapp',
    status: 'waiting',
    activity: 'needs you: run npm run migrate',
    progress: 0.6,
    todos: [
      { text: 'Move session logic to middleware', done: true },
      { text: 'Update tests', done: true },
      { text: 'Add refresh tokens', done: true },
      { text: 'Run migration', done: false },
      { text: 'Write changelog', done: false },
    ],
    diffStat: { files: 7, added: 212, removed: 88 },
    transcript: [
      { at: now() - 30 * min, role: 'you', text: 'Refactor auth into middleware and add refresh tokens.' },
      { at: now() - 12 * min, role: 'claude', text: 'Moved session checks into authMiddleware.ts. Tests pass (48/48).' },
      { at: now() - 3 * min, role: 'tool', text: 'run npm run migrate' },
    ],
  });
  const flaky = session({
    name: 'fix flaky tests',
    repo: 'webapp',
    status: 'running',
    activity: 'running vitest --repeat 20',
    progress: 0.3,
    todos: [
      { text: 'Find flaky tests', done: true },
      { text: 'Fix timer mocks', done: false },
      { text: 'Re-run 20x', done: false },
    ],
    diffStat: { files: 2, added: 14, removed: 9 },
    transcript: [{ at: now() - 8 * min, role: 'claude', text: 'Two tests use real timers. Switching to fake timers.' }],
  });
  const docs = session({
    name: 'readme pass',
    repo: 'so101-bridge',
    status: 'idle',
    activity: 'done · waiting for you',
    progress: 1,
    diffStat: { files: 1, added: 64, removed: 12 },
    transcript: [{ at: now() - 20 * min, role: 'claude', text: 'README rewritten with setup steps and a wiring diagram.' }],
  });
  const plan = session({
    name: 'spotify widget',
    repo: 'claude-shell',
    status: 'waiting',
    activity: 'asks: where should the volume ring go?',
    progress: 0.2,
  });
  state.sessions = [auth, flaky, plan, docs];
  state.repos = ['claude-shell', 'so101-bridge', 'webapp'];
  state.approvals = [
    {
      id: randomUUID(),
      sessionId: auth.id,
      sessionName: auth.name,
      tool: 'Bash',
      title: 'run database migration',
      detail: 'npm run migrate -- --env dev',
      alwaysLabel: 'Bash(npm run migrate *)',
      at: now() - 3 * min,
    },
  ];
  state.questions = [
    {
      id: randomUUID(),
      sessionId: plan.id,
      sessionName: plan.name,
      header: 'layout',
      question: 'Where should the volume ring go?',
      options: [
        { label: 'around the cover', description: 'like Meta Music' },
        { label: 'right edge', description: 'thin vertical bar' },
        { label: 'hidden', description: 'pinch-twist only' },
      ],
      multiSelect: false,
      at: now() - 5 * min,
    },
  ];
  state.track = {
    title: 'Midnight City',
    artist: 'M83',
    album: "Hurry Up, We're Dreaming",
    art: null,
    durationMs: 243_000,
    progressMs: 81_000,
    playing: true,
    volume: 60,
    device: 'iPhone',
  };
  state.picks = ['Focus mix', 'Lo-fi beats', 'Daily Mix 1', 'Discover Weekly', 'Release Radar'].map((title, i) => ({
    uri: `spotify:playlist:demo${i}`,
    title,
    art: null,
  }));
  const t = new Date();
  t.setMinutes(0, 0, 0);
  const at = (h: number) => t.getTime() + h * 3600_000;
  state.agenda = [
    { id: 'e1', title: 'Standup', start: at(1), end: at(1.25), location: null, meetUrl: 'https://meet.google.com/abc-defg-hij' },
    { id: 'e2', title: 'Lunch with Sam', start: at(3), end: at(4), location: 'Tartine, 600 Guerrero St', meetUrl: null },
    { id: 'e3', title: 'Robot arm wiring', start: at(6), end: at(7.5), location: null, meetUrl: null },
  ];
  state.mail = [
    { id: 'm1', from: 'GitHub', subject: 'PR #42 approved', snippet: 'alexr approved these changes', at: now() - 15 * min, unread: true },
    { id: 'm2', from: 'Prof. Lee', subject: 'Office hours moved', snippet: 'Thursday 3pm instead of 2pm.', at: now() - 70 * min, unread: true },
    { id: 'm3', from: 'Spotify', subject: 'Your weekly mix', snippet: 'Fresh picks for you', at: now() - 300 * min, unread: false },
  ];
  state.contacts = [
    { id: 'c1', name: 'Mom', initials: 'M', phone: '+15555550100', whatsapp: true, lastText: 'call me when free', lastAt: now() - 9 * min, lastSource: 'whatsapp', unread: 1 },
    { id: 'c2', name: 'Alex Rivera', initials: 'AR', phone: '+15555550101', chatGuid: 'demo', lastText: 'pushed the fix 👍', lastAt: now() - 25 * min, lastSource: 'messages', unread: 2 },
    { id: 'c3', name: 'Sam', initials: 'S', phone: '+15555550102', whatsapp: true, lastText: 'missed call', lastAt: now() - 120 * min, lastSource: 'call' },
    { id: 'c4', name: 'Robotics club', initials: 'RC', whatsapp: true, lastText: 'meeting moved to 7', lastAt: now() - 200 * min, lastSource: 'whatsapp' },
  ];
  Object.assign(state.integrations, { claude: true, groq: true, spotify: true, google: true, maps: true, messages: true, photos: true, totp: true, demo: true });
  hub.changed();

  // Make the running session tick so the lens has something alive to show.
  setInterval(() => {
    flaky.progress = Math.min(1, (flaky.progress ?? 0) + 0.05);
    if (flaky.progress >= 1) {
      flaky.progress = 0.3;
    }
    flaky.lastActivity = now();
    if (state.track?.playing) state.track.progressMs = (state.track.progressMs + 5000) % state.track.durationMs;
    hub.changed();
  }, 5000);
}

export function demoHandle(msg: ClientMsg) {
  const find = (id: string) => state.sessions.find((s) => s.id === id);
  switch (msg.t) {
    case 'approval.decide': {
      const a = state.approvals.find((x) => x.id === msg.id);
      state.approvals = state.approvals.filter((x) => x.id !== msg.id);
      if (a && msg.decision === 'always') state.settings.learnedRules.push(a.alwaysLabel);
      const s = a && find(a.sessionId);
      if (s) {
        s.status = msg.decision === 'deny' ? 'idle' : 'running';
        s.activity = msg.decision === 'deny' ? 'stopped: you declined' : 'migrating dev database';
      }
      break;
    }
    case 'question.answer': {
      const q = state.questions.find((x) => x.id === msg.id);
      state.questions = state.questions.filter((x) => x.id !== msg.id);
      const s = q && find(q.sessionId);
      if (s) {
        s.status = 'running';
        s.activity = `building: ${Object.values(msg.answers)[0]}`;
        s.transcript.push({ at: now(), role: 'you', text: Object.values(msg.answers)[0] ?? '' });
      }
      break;
    }
    case 'session.start': {
      const s = session({ name: msg.name || msg.prompt.slice(0, 30), repo: msg.repo, status: 'running', activity: 'reading the codebase' });
      s.transcript.push({ at: now(), role: 'you', text: msg.prompt });
      state.sessions.unshift(s);
      break;
    }
    case 'session.send':
    case 'ask': {
      const ids = msg.t === 'ask' ? (msg.target === 'all' ? state.sessions.map((s) => s.id) : [msg.target]) : [msg.id];
      for (const id of ids) {
        const s = find(id);
        if (!s) continue;
        s.transcript.push({ at: now(), role: 'you', text: msg.text });
        s.transcript.push({ at: now() + 1, role: 'claude', text: `On it. (demo reply to "${msg.text.slice(0, 40)}")` });
        s.status = 'running';
        s.lastActivity = now();
      }
      break;
    }
    case 'session.stop': {
      const s = find(msg.id);
      if (s) Object.assign(s, { status: 'stopped', activity: 'stopped · send a message to resume' });
      break;
    }
    case 'spotify': {
      const t = state.track;
      if (!t) break;
      if (msg.action === 'play') t.playing = true;
      if (msg.action === 'pause') t.playing = false;
      if (msg.action === 'next' || msg.action === 'prev') Object.assign(t, { title: msg.action === 'next' ? 'Wait' : 'Outro', progressMs: 0 });
      if (msg.action === 'volume') t.volume = Number(msg.value);
      if (msg.action === 'playUri') Object.assign(t, { title: state.picks.find((p) => p.uri === msg.value)?.title ?? 'Mix', progressMs: 0, playing: true });
      break;
    }
    case 'comms.send': {
      const c = state.contacts.find((x) => x.id === msg.contactId);
      if (c) Object.assign(c, { lastText: `you: ${msg.text}`, lastAt: now(), unread: 0 });
      break;
    }
    default:
      return false;
  }
  hub.changed();
  return true;
}

// ---------- demo photos: generated landscapes, so the grid and viewer have something to show ----------
const PLACES = ['Ocean Beach', 'Yosemite', 'Mission District', 'Tahoe', 'Golden Gate Park', 'Big Sur'];
const TAGS = ['beach sunset meta ai', 'mountains hike', 'street food meta ai', 'snow', 'dog park', 'coast road'];
const DEMO_PHOTOS = Array.from({ length: 48 }, (_, i) => ({
  id: `demo-${i}`,
  date: Date.now() - i * 2.7 * 86400_000,
  title: `IMG_${4100 + i}.HEIC`,
  place: PLACES[i % PLACES.length],
  favorite: i % 7 === 0,
  tags: `${TAGS[i % TAGS.length]} ${PLACES[i % PLACES.length]} ${i % 7 === 0 ? 'favorite favorites' : ''}`.toLowerCase(),
}));

export function demoPhotos(q: string, offset: number) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = DEMO_PHOTOS.filter((p) => words.every((w) => p.tags.includes(w)));
  return { total: hits.length, items: hits.slice(offset, offset + 32).map(({ tags, ...p }) => p) };
}

export function demoPhotoSvg(id: string) {
  const i = Number(id.split('-')[1]) || 0;
  const skies = [['#ff6188', '#fd971f'], ['#66d9ef', '#ae81ff'], ['#272822', '#ae81ff'], ['#e6db74', '#ff6188'], ['#a6e22e', '#66d9ef'], ['#fd971f', '#272822']];
  const [a, b] = skies[i % skies.length];
  const h1 = 220 + ((i * 37) % 80), h2 = 260 + ((i * 53) % 70);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" width="600" height="450">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="600" height="450" fill="url(#s)"/><circle cx="${150 + ((i * 71) % 300)}" cy="140" r="46" fill="#f8f8f2" opacity=".85"/>
<path d="M0 ${h1} L140 ${h1 - 90} L260 ${h1 - 20} L400 ${h1 - 120} L600 ${h1 - 30} V450 H0Z" fill="#1e1f1c" opacity=".7"/>
<path d="M0 ${h2} L180 ${h2 - 60} L330 ${h2 - 10} L470 ${h2 - 70} L600 ${h2} V450 H0Z" fill="#1e1f1c"/></svg>`;
}
