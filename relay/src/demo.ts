import { randomUUID } from 'node:crypto';
import type { ClientMsg, SessionInfo, TranscriptItem } from '../../shared/protocol.ts';
import { hub, state } from './hub.ts';

/**
 * DEMO=1: fake sessions, approvals and questions,
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
    context: { used: 92_000, limit: 200_000 },
    source: 'shell',
    kind: 'code',
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
      {
        at: now() - 12 * min,
        role: 'claude',
        text: [
          '## Auth is now middleware',
          '',
          'Moved the session checks into **authMiddleware.ts**. Tests pass (48/48).',
          '',
          '- `requireUser()` guards every `/api` route',
          '- refresh tokens rotate on each use, 30-day expiry',
          '- old `checkSession()` calls removed (12 files)',
          '',
          'Next: run the migration that adds the `refresh_tokens` table. It needs your OK.',
        ].join('\n'),
      },
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
    source: 'external', // looks like a terminal / Remote Control session
    cwd: '~/code/so101-bridge',
    activity: 'done · waiting for you',
    progress: 1,
    diffStat: { files: 1, added: 64, removed: 12 },
    transcript: [{ at: now() - 20 * min, role: 'claude', text: 'README rewritten with setup steps and a wiring diagram.' }],
  });
  const plan = session({
    name: 'status widget',
    repo: 'claudeprod',
    status: 'waiting',
    activity: 'asks: where should the progress ring go?',
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
      question: 'Where should the progress ring go?',
      options: [
        { label: 'around the title', description: 'circular' },
        { label: 'right edge', description: 'thin vertical bar' },
        { label: 'hidden', description: 'details screen only' },
      ],
      multiSelect: false,
      at: now() - 5 * min,
    },
  ];
  Object.assign(state.integrations, { claude: true, groq: true, totp: true, appLock: false, demo: true });
  hub.changed();

  // Make the running session tick so the lens has something alive to show.
  setInterval(() => {
    flaky.progress = Math.min(1, (flaky.progress ?? 0) + 0.05);
    if (flaky.progress >= 1) {
      flaky.progress = 0.3;
    }
    flaky.lastActivity = now();
    // A scripted stream of steps and messages, so the live feed has something arriving.
    const beat = SCRIPT[tick++ % SCRIPT.length];
    flaky.transcript.push({ at: now(), role: beat[0], text: beat[1] });
    if (beat[0] === 'tool') flaky.activity = beat[1];
    if (flaky.transcript.length > 30) flaky.transcript.splice(0, flaky.transcript.length - 30);
    hub.changed();
  }, 2500);
}

let tick = 0;
const SCRIPT: [TranscriptItem['role'], string][] = [
  ['tool', 'Read src/timers.test.ts'],
  ['tool', 'Edit src/timers.test.ts'],
  ['tool', 'Run vitest --repeat 20'],
  ['claude', '20/20 green with fake timers. Checking the second flaky test next.'],
  ['tool', 'Grep "setTimeout" in src'],
  ['tool', 'Read src/retry.ts'],
  ['claude', 'The retry test waits on a real 2 s backoff. Injecting the clock instead.'],
  ['tool', 'Edit src/retry.ts'],
  ['tool', 'Run vitest src/retry.test.ts'],
];

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
      const s = session({ name: msg.name || msg.prompt.slice(0, 30), repo: msg.repo || 'chat', kind: msg.repo ? 'code' : 'chat', status: 'running', activity: msg.repo ? 'reading the codebase' : 'checking your calendar' });
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
    default:
      return false;
  }
  hub.changed();
  return true;
}
