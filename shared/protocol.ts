// Wire protocol between the glasses app and the relay (JSON over one WebSocket).
// Both sides import this file, so changing a type here changes it everywhere.

export type SessionStatus = 'starting' | 'running' | 'waiting' | 'idle' | 'done' | 'error' | 'stopped';

export interface TranscriptItem {
  at: number;
  role: 'you' | 'claude' | 'tool' | 'system';
  text: string;
}

export interface SessionInfo {
  id: string;
  name: string;
  repo: string;
  branch: string;
  status: SessionStatus;
  startedAt: number;
  lastActivity: number;
  /** One line: what the session is doing right now. */
  activity: string;
  /** 0..1 if the agent keeps a todo list, else null. */
  progress: number | null;
  todos: { text: string; done: boolean }[];
  diffStat: { files: number; added: number; removed: number };
  transcript: TranscriptItem[];
  costUsd: number;
  /**
   * shell = started by the relay (own worktree, full control).
   * external = any other Claude Code session on the relay's machine (terminal, VS Code, Remote Control),
   * seen through hooks. Approvals and questions work; messages are delivered when it next stops,
   * or continue it on the relay as a fork if it's idle.
   */
  source: 'shell' | 'external';
  /** Working directory. */
  cwd?: string;
  /** code = a repo session (own worktree, or an outside session in a repo); chat = a one-off with no repo. */
  kind: 'code' | 'chat';
  /** Open on the laptop right now (a VS Code tab or a terminal). Those windows don't refresh on their own. */
  desk?: 'vscode' | 'terminal';
}

export interface Approval {
  id: string;
  sessionId: string;
  sessionName: string;
  tool: string;
  /** Short human sentence, e.g. "Run npm test". */
  title: string;
  /** Command, path or diff preview, already trimmed for the lens. */
  detail: string;
  /** Lines of a unified diff, when the tool edits a file. */
  diff?: { kind: '+' | '-' | ' '; text: string }[];
  /** What "↓ always" would remember, e.g. "Bash: npm run *". */
  alwaysLabel: string;
  at: number;
}

export interface Question {
  id: string;
  sessionId: string;
  sessionName: string;
  header: string;
  question: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
  at: number;
}

/** everything = auto-approve every tool call, in every session (nothing asks). */
export type ApprovalPreset = 'careful' | 'balanced' | 'trusting' | 'everything';

export interface Settings {
  approvals: ApprovalPreset;
  background: 'gray' | 'black';
  /** After the glasses finish a turn on a laptop session, reopen it there so it shows everything. */
  syncToLaptop: boolean;
  learnedRules: string[];
}

export interface Integrations {
  claude: boolean;
  groq: boolean;
  /** 2FA codes set up (TOTP_PASSPHRASE + TOTP_UNLOCK + an imported vault). */
  totp: boolean;
  /** The whole app is behind a pattern/password (APP_PATTERN / APP_PASSWORD). */
  appLock: boolean;
  demo: boolean;
}

/** A one-pinch reply. `label` is shown on the chip, `text` is what Claude receives. */
export interface Phrase {
  label: string;
  text: string;
}

export interface ShellState {
  sessions: SessionInfo[];
  approvals: Approval[];
  questions: Question[];
  repos: string[];
  /** Quick replies (DATA_DIR/phrases.json). */
  phrases: Phrase[];
  settings: Settings;
  integrations: Integrations;
  serverTime: number;
  /** The Mac the relay runs on: battery and Wi-Fi (polled every 30 s). */
  host: HostInfo;
  /** Changes when the glasses app is rebuilt; the lens reloads itself to pick up the new version. */
  build: string;
}

export interface TotpCode {
  id: string;
  issuer: string;
  account: string;
  code: string;
  period: number;
  /** Seconds until this code changes. */
  remaining: number;
}

export interface HostInfo {
  battery: number | null;
  charging: boolean;
  /** connected = Wi-Fi joined with an address; off = radio off; down = on but not joined; null = no Wi-Fi port. */
  wifi: 'connected' | 'down' | 'off' | null;
  ssid?: string;
}

export interface StatusReport {
  at: number;
  /** 2-3 sentence overview, benchmarked against the previous check when there is one. */
  headline: string;
  /** When the previous check ran (what "since last" compares with). */
  previousAt?: number;
  /**
   * Every session, ones waiting on you first. `text` = where it stands; `change` = what moved since the last
   * check; `answer` = the session's own reply to the status question, in its words.
   */
  lines: { id: string; session: string; status: SessionStatus; needsYou: boolean; text: string; change?: string; answer?: string }[];
}

// ---------- client → relay ----------
export type ClientMsg =
  /** repo '' = a one-off chat with no repo (connectors available). */
  | { t: 'session.start'; repo: string; prompt: string; name?: string }
  | { t: 'session.send'; id: string; text: string }
  | { t: 'session.stop'; id: string }
  /** Open this session on the laptop (VS Code tab or terminal), freshly loaded. */
  | { t: 'session.openDesk'; id: string }
  | { t: 'session.interrupt'; id: string }
  | { t: 'approval.decide'; id: string; decision: 'allow' | 'deny' | 'always' }
  | { t: 'question.answer'; id: string; answers: Record<string, string> }
  | { t: 'ask'; target: 'all' | string; text: string }
  | { t: 'status.check' }
  | { t: 'dictation.clean'; reqId: string; text: string; context?: string }
  | { t: 'settings.set'; patch: Partial<Settings> }
  | { t: 'rules.clear' }
  /** 2FA: unlock with the swipe pattern; codes go only to this connection. */
  /** App lock: unlock with the swipe pattern or the password. */
  | { t: 'app.unlock'; pattern?: string[]; password?: string }
  | { t: 'totp.unlock'; seq: string[] }
  | { t: 'totp.list' }
  | { t: 'totp.lock' }
  | { t: 'refresh' };

// ---------- relay → client ----------
export type ServerMsg =
  | { t: 'state'; state: ShellState }
  | { t: 'status.report'; report: StatusReport }
  /** App lock: nothing else is sent until you unlock. */
  | { t: 'app.locked'; method: 'pattern' | 'password'; reason?: string; triesLeft?: number }
  /** Unlocked: keep `pass` and connect with it (?s=) until `until`. */
  | { t: 'app.unlocked'; pass: string; until: number }
  | { t: 'totp.codes'; codes: TotpCode[]; unlockedUntil: number }
  | { t: 'totp.locked'; reason?: string; triesLeft?: number }
  | { t: 'dictation.cleaned'; reqId: string; text: string }
  | { t: 'notify'; text: string; level: 'info' | 'good' | 'warn' | 'error'; sessionId?: string }
  | { t: 'card'; sessionId: string; title: string; body: string }
  | { t: 'error'; text: string };
