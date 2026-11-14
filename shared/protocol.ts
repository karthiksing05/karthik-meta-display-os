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

export interface Track {
  title: string;
  artist: string;
  album: string;
  art: string | null;
  durationMs: number;
  progressMs: number;
  playing: boolean;
  volume: number | null;
  device: string | null;
}

export interface Pick {
  uri: string;
  title: string;
  art: string | null;
}

export interface AgendaItem {
  id: string;
  title: string;
  start: number;
  end: number;
  location: string | null;
  meetUrl: string | null;
}

export interface MailItem {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  at: number;
  unread: boolean;
}

export interface Contact {
  id: string;
  name: string;
  initials: string;
  phone?: string;
  /** Has WhatsApp: the pane offers it, and hands off to the built-in app. */
  whatsapp?: boolean;
  /** BlueBubbles chat GUID for iMessage threads. */
  chatGuid?: string;
  lastText?: string;
  lastAt?: number;
  lastSource?: 'messages' | 'whatsapp' | 'call';
  unread?: number;
}

export interface RouteInfo {
  destination: string;
  durationMin: number;
  distanceKm: number;
  steps: { text: string; distanceM: number }[];
  /** Relay URL of a static map image (key stays on the relay). */
  mapUrl: string | null;
}

export interface PhotoItem {
  id: string;
  date: number;
  title: string;
  place: string | null;
  favorite: boolean;
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

export type ApprovalPreset = 'careful' | 'balanced' | 'trusting';

export interface Settings {
  approvals: ApprovalPreset;
  animation: 'wave' | 'rain' | 'life' | 'off';
  background: 'gray' | 'black';
  dictationCleanup: boolean;
  learnedRules: string[];
}

export interface Integrations {
  claude: boolean;
  groq: boolean;
  spotify: boolean;
  google: boolean;
  maps: boolean;
  messages: boolean;
  photos: boolean;
  totp: boolean;
  demo: boolean;
}

export interface ShellState {
  sessions: SessionInfo[];
  approvals: Approval[];
  questions: Question[];
  repos: string[];
  track: Track | null;
  picks: Pick[];
  agenda: AgendaItem[];
  mail: MailItem[];
  contacts: Contact[];
  settings: Settings;
  integrations: Integrations;
  bookmarks: { name: string; url: string }[];
  favorites: { name: string; address: string }[];
  serverTime: number;
}

export interface StatusReport {
  at: number;
  headline: string;
  lines: { session: string; status: SessionStatus; text: string }[];
}

// ---------- client → relay ----------
export type ClientMsg =
  | { t: 'session.start'; repo: string; prompt: string; name?: string }
  | { t: 'session.send'; id: string; text: string }
  | { t: 'session.stop'; id: string }
  | { t: 'session.interrupt'; id: string }
  | { t: 'approval.decide'; id: string; decision: 'allow' | 'deny' | 'always' }
  | { t: 'question.answer'; id: string; answers: Record<string, string> }
  | { t: 'ask'; target: 'all' | string; text: string }
  | { t: 'status.check' }
  | { t: 'dictation.clean'; reqId: string; text: string; context?: string }
  | { t: 'spotify'; action: 'play' | 'pause' | 'next' | 'prev' | 'volume' | 'playUri'; value?: number | string }
  | { t: 'comms.send'; contactId: string; text: string }
  | { t: 'route'; destination: string; from?: { lat: number; lng: number } }
  | { t: 'settings.set'; patch: Partial<Settings> }
  | { t: 'rules.clear' }
  | { t: 'photos.query'; q?: string; offset?: number }
  | { t: 'totp.unlock'; seq: string[] }
  | { t: 'totp.list' }
  | { t: 'totp.lock' }
  | { t: 'refresh' };

// ---------- relay → client ----------
export type ServerMsg =
  | { t: 'state'; state: ShellState }
  | { t: 'status.report'; report: StatusReport }
  | { t: 'dictation.cleaned'; reqId: string; text: string }
  | { t: 'route.result'; route: RouteInfo | null; error?: string }
  | { t: 'notify'; text: string; level: 'info' | 'good' | 'warn' | 'error'; sessionId?: string }
  | { t: 'card'; sessionId: string; title: string; body: string }
  | { t: 'photos.result'; q: string; items: PhotoItem[]; total: number; offset: number; error?: string }
  | { t: 'totp.codes'; codes: TotpCode[]; unlockedUntil: number }
  | { t: 'totp.locked'; reason?: string; triesLeft?: number }
  | { t: 'error'; text: string };
