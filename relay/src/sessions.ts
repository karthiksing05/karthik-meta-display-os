import { query, type Query, type SDKMessage, type SDKUserMessage, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ContextUse, SessionInfo, TranscriptItem } from '../../shared/protocol.ts';
import { contextOf } from './context.ts';
import { claudeEnv, config } from './config.ts';
import { hub, state } from './hub.ts';
import { load, save } from './store.ts';
import { decide, previewFor, ruleFor, titleFor } from './approvals.ts';
import { CHAT_PROMPT, glassesMcp, GLASSES_PROMPT, WORKTREE_NOTE } from './glassesMcp.ts';
import { NOTES_PROMPT, notesDir, notesMcp } from './notes.ts';
import { deskOf, onDeskChange, openOnDesk } from './desk.ts';
import { externalAnswer, externalDecide, externalList, externalSend, forgetExternal } from './external.ts';

const run = promisify(execFile);
const MAX_TRANSCRIPT = 60;

/** Push-based async iterable: how we feed follow-up messages into a live session. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  push(text: string) {
    this.items.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    } as SDKUserMessage);
    this.wake?.();
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.items.length) yield this.items.shift()!;
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

interface Saved {
  id: string;
  name: string;
  repo: string;
  branch: string;
  worktree: string;
  base: string;
  sdkSessionId: string | null;
  startedAt: number;
  /** Last known context use (replaces the old costUsd). */
  context?: ContextUse | null;
  /** code = repo session; chat = one-off with no repo. Missing on sessions saved by older versions (= code). */
  kind?: 'code' | 'chat';
  /** An outside session (terminal / VS Code / Remote Control) the relay continued in place, same session ID. */
  adopted?: boolean;
  /** The one notes session (the notes tile): Apple Notes tools, always the same folder. */
  notes?: boolean;
}

interface Live {
  info: SessionInfo;
  saved: Saved;
  inbox: Inbox | null;
  q: Query | null;
  abort: AbortController | null;
  /** The model's real context window, once a result has reported it. */
  ctxWindow?: number;
}

const live = new Map<string, Live>();
const pendingApprovals = new Map<string, (r: PermissionResult) => void>();
const pendingQuestions = new Map<string, (answers: Record<string, string>) => void>();

// ---------- repos & worktrees ----------

/**
 * Git repos under REPOS_DIR, up to 3 levels deep (e.g. "MPI-Research/persona-translation").
 * Stops descending at the first .git; skips hidden folders, node_modules and the like.
 */
export function scanRepos(): string[] {
  const out: string[] = [];
  const SKIP = new Set(['node_modules', 'Library', 'dist', 'build', 'venv', '.venv', '__pycache__']);
  const walk = (rel: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(config.reposDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (!d.isDirectory() || d.name.startsWith('.') || SKIP.has(d.name)) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (fs.existsSync(path.join(config.reposDir, r, '.git'))) out.push(r);
      else if (depth < 3) walk(r, depth + 1);
    }
  };
  walk('', 1);
  // Most recently used first (git touches .git/index on commits, checkouts and adds).
  const used = (r: string) => {
    for (const f of ['index', 'HEAD']) {
      try {
        return fs.statSync(path.join(config.reposDir, r, '.git', f)).mtimeMs;
      } catch {}
    }
    return 0;
  };
  return out.map((r) => [r, used(r)] as const).sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'task';
}

async function makeWorktree(repo: string, name: string, id: string) {
  const repoPath = path.join(config.reposDir, repo);
  if (!fs.existsSync(path.join(repoPath, '.git'))) throw new Error(`${repo} is not a git repo in ${config.reposDir}`);
  const branch = `shell/${slug(name)}-${id.slice(0, 4)}`;
  const worktree = path.join(config.worktreesDir, `${repo.replace(/[\\/]/g, '-')}-${slug(name)}-${id.slice(0, 4)}`);
  await run('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, worktree, 'HEAD']);
  const { stdout } = await run('git', ['-C', worktree, 'rev-parse', 'HEAD']);
  return { branch, worktree, base: stdout.trim() };
}

/** Everything changed since the session started: commits on its branch plus uncommitted edits. */
async function diffStat(worktree: string, base: string) {
  try {
    const { stdout } = await run('git', ['-C', worktree, 'diff', '--numstat', base || 'HEAD'], { maxBuffer: 1 << 20 });
    let files = 0, added = 0, removed = 0;
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const [a, r] = line.split('\t');
      files++;
      added += Number(a) || 0;
      removed += Number(r) || 0;
    }
    return { files, added, removed };
  } catch {
    return { files: 0, added: 0, removed: 0 };
  }
}

// ---------- session lifecycle ----------

function persist() {
  save('sessions', [...live.values()].map((l) => l.saved));
}

export function publish() {
  state.sessions = [...[...live.values()].map((l) => l.info), ...externalList()].sort((a, b) => b.lastActivity - a.lastActivity);
  for (const s of state.sessions) {
    const d = deskOf(s.id);
    if (d) s.desk = d;
    else delete s.desk;
  }
  hub.changed();
}
onDeskChange(publish);

/** Claude session IDs the relay runs itself (so hooks from them are ignored). */
/** The saved Claude conversation behind a lens session (for a read-only status fork), if there is one yet. */
export function sdkTargetOf(s: SessionInfo): { sdkId: string; cwd: string } | null {
  const l = live.get(s.id);
  const cwd = l ? l.saved.worktree || l.info.cwd : s.cwd;
  if (l) return l.saved.sdkSessionId && cwd ? { sdkId: l.saved.sdkSessionId, cwd } : null;
  return s.source === 'external' && s.cwd ? { sdkId: s.id, cwd: s.cwd } : null;
}

export function ownsSdkSession(sdkId: string) {
  for (const l of live.values()) if (l.saved.sdkSessionId === sdkId) return true;
  return false;
}

function log(l: Live, role: TranscriptItem['role'], text: string) {
  if (!text.trim()) return;
  l.info.transcript.push({ at: Date.now(), role, text: text.slice(0, 2000) });
  if (l.info.transcript.length > MAX_TRANSCRIPT) l.info.transcript.splice(0, l.info.transcript.length - MAX_TRANSCRIPT);
  l.info.lastActivity = Date.now();
}

/** Restore sessions from disk after a relay restart. They come back stopped; sending a message resumes them. */
export function restoreSessions() {
  for (const s of load<Saved[]>('sessions', [])) {
    if (!fs.existsSync(s.worktree)) continue;
    live.set(s.id, {
      saved: s,
      inbox: null,
      q: null,
      abort: null,
      info: {
        id: s.id, name: s.name, repo: s.repo, branch: s.branch, status: 'stopped', source: 'shell', cwd: s.worktree, kind: s.kind ?? 'code', notes: s.notes,
        startedAt: s.startedAt, lastActivity: s.startedAt, activity: 'stopped · send a message to resume',
        progress: null, todos: [], diffStat: { files: 0, added: 0, removed: 0 }, transcript: [], context: s.context ?? null,
      },
    });
  }
  state.repos = scanRepos();
  publish();
}

/** repo '' starts a one-off chat: no repo, its own empty folder, your connectors available. */
export async function startSession(repo: string, prompt: string, name?: string, notes = false): Promise<string> {
  const id = randomUUID();
  const title = notes ? 'notes' : name?.trim() || prompt.split(/[.?!\n]/)[0].slice(0, 40) || 'chat';
  const kind = repo ? 'code' : 'chat';
  let branch = '', worktree: string, base = '';
  if (kind === 'code') ({ branch, worktree, base } = await makeWorktree(repo, title, id));
  else fs.mkdirSync((worktree = notes ? notesDir : path.join(config.chatsDir, `${slug(title)}-${id.slice(0, 4)}`)), { recursive: true });
  const saved: Saved = { id, name: title, repo: notes ? 'notes' : repo || 'chat', branch, worktree, base, sdkSessionId: null, startedAt: Date.now(), kind, ...(notes ? { notes } : {}) };
  const l: Live = {
    saved,
    inbox: null,
    q: null,
    abort: null,
    info: {
      id, name: title, repo: saved.repo, branch, status: 'starting', source: 'shell', cwd: worktree, kind, notes: notes || undefined, startedAt: saved.startedAt, lastActivity: Date.now(),
      activity: 'starting', progress: null, todos: [], diffStat: { files: 0, added: 0, removed: 0 }, transcript: [], context: null,
    },
  };
  live.set(id, l);
  persist();
  log(l, 'you', prompt);
  spawn(l, prompt);
  publish();
  return id;
}

function spawn(l: Live, firstMessage: string) {
  const inbox = new Inbox();
  const abort = new AbortController();
  l.inbox = inbox;
  l.abort = abort;
  inbox.push(firstMessage);
  const sid = l.info.id;

  const q = query({
    prompt: inbox,
    options: {
      cwd: l.saved.worktree,
      abortController: abort,
      model: config.claudeModel,
      resume: l.saved.sdkSessionId ?? undefined,
      // Marks this as the relay's own process, so the Claude Shell hooks skip it (no double approvals).
      // In login mode it also drops the token so your login (and claude.ai connectors) are used.
      env: claudeEnv({ CLAUDE_SHELL_OWNED: '1' }),
      settingSources: ['user', 'project', 'local'],
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: l.saved.notes ? `${CHAT_PROMPT}\n${NOTES_PROMPT}` : l.info.kind === 'chat' ? CHAT_PROMPT : l.saved.adopted ? GLASSES_PROMPT : `${GLASSES_PROMPT}\n${WORKTREE_NOTE}`,
      },
      mcpServers: {
        glasses: glassesMcp({
          sessionId: sid,
          sessionName: () => l.info.name,
          ask: (header, question, options) =>
            askQuestion(l, header, question, options.map((label) => ({ label })), false).then(
              (a) => Object.values(a)[0] ?? '',
            ),
        }),
        ...(l.saved.notes ? { notes: notesMcp() } : {}),
      },
      canUseTool: (toolName, input, { signal }) => canUseTool(l, toolName, input, signal),
    },
  });
  l.q = q;
  l.info.status = 'running';
  consume(l, q).catch((err) => {
    l.info.status = abort.signal.aborted ? 'stopped' : 'error';
    l.info.activity = abort.signal.aborted ? 'stopped' : `error: ${String(err?.message ?? err).slice(0, 120)}`;
    log(l, 'system', l.info.activity);
    publish();
  });
}

async function consume(l: Live, q: Query) {
  for await (const msg of q as AsyncIterable<SDKMessage>) {
    handle(l, msg);
    publish();
  }
  if (l.info.status !== 'error') l.info.status = 'stopped';
  publish();
}

function handle(l: Live, msg: SDKMessage) {
  switch (msg.type) {
    case 'system':
      if ('subtype' in msg && msg.subtype === 'init') {
        l.saved.sdkSessionId = msg.session_id;
        forgetExternal(msg.session_id);
        persist();
      }
      break;
    case 'assistant': {
      l.info.status = 'running';
      if (!msg.parent_tool_use_id) l.info.context = contextOf(msg.message.usage, config.claudeModel ?? msg.message.model, l.ctxWindow) ?? l.info.context;
      for (const block of msg.message.content as Array<{ type: string; text?: string; name?: string; input?: any }>) {
        if (block.type === 'text' && block.text) {
          log(l, 'claude', block.text);
          l.info.activity = block.text.split('\n')[0].slice(0, 90);
        } else if (block.type === 'tool_use' && block.name) {
          const t = titleFor(block.name, block.input ?? {}, l.saved.worktree);
          l.info.activity = t;
          log(l, 'tool', t);
          if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
            l.info.todos = block.input.todos.map((x: any) => ({ text: String(x.content ?? x.activeForm ?? ''), done: x.status === 'completed' }));
            const total = l.info.todos.length;
            l.info.progress = total ? l.info.todos.filter((x) => x.done).length / total : null;
          }
        }
      }
      break;
    }
    case 'result': {
      // The real window size, once the SDK reports it.
      const win = Math.max(0, ...Object.values((msg as any).modelUsage ?? {}).map((u: any) => u?.contextWindow ?? 0));
      if (win && l.info.context) l.info.context = { ...l.info.context, limit: win };
      l.ctxWindow = win || l.ctxWindow;
      l.saved.context = l.info.context;
      const failed = msg.subtype !== 'success' || msg.is_error;
      l.info.status = failed ? 'error' : 'idle';
      l.info.activity = !failed
        ? 'done · waiting for you'
        : msg.subtype === 'success'
          ? `error: ${msg.result.slice(0, 100)}`
          : `stopped: ${msg.subtype}`;
      // The final text usually repeats the last assistant message; only log it if it's new.
      const lastText = [...l.info.transcript].reverse().find((t) => t.role === 'claude')?.text;
      if (msg.subtype === 'success' && msg.result && msg.result.slice(0, 2000) !== lastText) log(l, failed ? 'system' : 'claude', msg.result);
      persist();
      if (l.saved.adopted && !failed) syncToLaptop(l);
      if (l.info.kind === 'code')
        diffStat(l.saved.worktree, l.saved.base).then((d) => {
          l.info.diffStat = d;
          publish();
        });
      break;
    }
    default:
      break;
  }
}

async function canUseTool(l: Live, tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
  // Claude's own multiple-choice questions go to the question inbox.
  if (tool === 'AskUserQuestion') {
    const qs = (input.questions as any[]) ?? [];
    const answers: Record<string, string> = {};
    for (const q of qs) {
      const a = await askQuestion(l, q.header ?? 'question', q.question, q.options ?? [], Boolean(q.multiSelect), signal);
      answers[q.question] = Object.values(a)[0] ?? '';
    }
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  }

  // The notes session's own Apple Notes tools (they back up before every rewrite).
  if (l.saved.notes && tool.startsWith('mcp__notes__')) return { behavior: 'allow', updatedInput: input };

  const verdict = decide(state.settings.approvals, state.settings.learnedRules, tool, input, l.saved.worktree);
  if (verdict === 'allow') return { behavior: 'allow', updatedInput: input };

  const id = randomUUID();
  const prev = l.info.status;
  l.info.status = 'waiting';
  l.info.activity = `needs you: ${titleFor(tool, input, l.saved.worktree)}`;
  state.approvals.push({
    id,
    sessionId: l.info.id,
    sessionName: l.info.name,
    tool,
    title: titleFor(tool, input, l.saved.worktree),
    alwaysLabel: ruleFor(tool, input),
    at: Date.now(),
    ...previewFor(tool, input),
  });
  publish();
  hub.broadcast({ t: 'notify', text: `${l.info.name} needs approval`, level: 'warn', sessionId: l.info.id });

  const result = await new Promise<PermissionResult>((resolve) => {
    pendingApprovals.set(id, resolve);
    signal.addEventListener('abort', () => resolve({ behavior: 'deny', message: 'Session stopped.' }), { once: true });
  });
  pendingApprovals.delete(id);
  state.approvals = state.approvals.filter((a) => a.id !== id);
  l.info.status = prev === 'waiting' ? 'running' : prev;
  if (l.info.status === 'starting') l.info.status = 'running';
  publish();
  return result.behavior === 'allow' ? { ...result, updatedInput: input } : result;
}

function askQuestion(
  l: Live,
  header: string,
  question: string,
  options: { label: string; description?: string }[],
  multiSelect: boolean,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const id = randomUUID();
  state.questions.push({ id, sessionId: l.info.id, sessionName: l.info.name, header, question, options, multiSelect, at: Date.now() });
  l.info.status = 'waiting';
  l.info.activity = `asks: ${question.slice(0, 80)}`;
  publish();
  hub.broadcast({ t: 'notify', text: `${l.info.name} asks a question`, level: 'warn', sessionId: l.info.id });
  return new Promise((resolve) => {
    const done = (a: Record<string, string>) => {
      pendingQuestions.delete(id);
      state.questions = state.questions.filter((q) => q.id !== id);
      l.info.status = 'running';
      log(l, 'you', Object.values(a).join(', '));
      publish();
      resolve(a);
    };
    pendingQuestions.set(id, done);
    signal?.addEventListener('abort', () => done({ [question]: '(no answer: session stopped)' }), { once: true });
  });
}

// ---------- commands from the glasses ----------

export function decideApproval(id: string, decision: 'allow' | 'deny' | 'always') {
  if (externalDecide(id, decision)) return;
  const resolve = pendingApprovals.get(id);
  const a = state.approvals.find((x) => x.id === id);
  if (!resolve || !a) return;
  if (decision === 'always') {
    if (!state.settings.learnedRules.includes(a.alwaysLabel)) state.settings.learnedRules.push(a.alwaysLabel);
    hub.saveSettings();
  }
  resolve(decision === 'deny' ? { behavior: 'deny', message: 'The user declined this on their glasses.' } : { behavior: 'allow' });
}

export function answerQuestion(id: string, answers: Record<string, string>) {
  if (externalAnswer(id, answers)) return;
  pendingQuestions.get(id)?.(answers);
}

export function sendToSession(id: string, text: string) {
  const l = live.get(id);
  if (!l) return externalSend(id, text);
  log(l, 'you', text);
  if (l.inbox && l.q && !['stopped', 'error'].includes(l.info.status)) {
    l.inbox.push(text);
    l.info.status = 'running';
  } else {
    spawn(l, text); // resumes the saved Claude session
  }
  publish();
}

/** The notes tile: send to the one notes session, starting it the first time. Returns its id. */
export async function askNotes(text: string): Promise<string> {
  const l = [...live.values()].find((x) => x.saved.notes);
  if (l) {
    sendToSession(l.info.id, text);
    return l.info.id;
  }
  return startSession('', text, 'notes', true);
}

/**
 * Send a real message into a session's chat (same path as replying from the lens) and wait for
 * Claude's reply to it. Resolves with the reply text, or '' if none came within timeoutMs.
 */
export async function askInChat(id: string, text: string, timeoutMs: number): Promise<string> {
  const t0 = Date.now();
  sendToSession(id, text);
  const reply = () =>
    (live.get(id)?.info.transcript ?? [])
      .filter((t) => t.at >= t0 && t.role === 'claude')
      .map((t) => t.text)
      .join('\n');
  while (Date.now() - t0 < timeoutMs) {
    await sleep(500);
    const st = live.get(id)?.info.status;
    if (st === 'idle' || st === 'error' || st === 'stopped') return reply();
  }
  return reply(); // still going: whatever it has said so far
}

// ---------- keeping the laptop in sync ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const deskName = (d: string) => (d === 'vscode' ? 'VS Code tab' : 'terminal');

/** Let the relay's own process for this session finish, so the laptop can take the session over. */
async function letGo(l: Live) {
  if (!l.q || ['starting', 'running', 'waiting'].includes(l.info.status)) return;
  l.inbox?.close();
  for (let i = 0; i < 20 && l.info.status !== 'stopped' && l.info.status !== 'error'; i++) await sleep(150);
  await sleep(500);
}

/**
 * The glasses just finished a turn on a session from your laptop. A window that's already open there
 * can't refresh, so: if it isn't open, open it (it loads fresh with every turn); if it is, say it's
 * out of date.
 *
 * It waits until you've stopped iterating: only after SYNC_QUIET_MS with no new turn. Each finished
 * turn schedules this again and the older call gives up (the transcript grew), so going back and
 * forth from the glasses never opens a laptop tab mid-conversation, which would then be stale.
 */
const SYNC_QUIET_MS = 90_000;
async function syncToLaptop(l: Live) {
  if (!state.settings.syncToLaptop || config.demo) return;
  const turns = l.info.transcript.length;
  await sleep(SYNC_QUIET_MS);
  if (live.get(l.info.id) !== l || l.info.status !== 'idle' || l.info.transcript.length !== turns) return;
  const d = deskOf(l.info.id);
  if (d) {
    l.info.activity = `done · your ${deskName(d)} for this is out of date: close it, then "open on laptop"`;
    return publish();
  }
  await letGo(l);
  try {
    const how = await openOnDesk(l.info.id, l.saved.worktree || l.info.cwd);
    l.info.activity = `done · ${how}, up to date`;
  } catch (e) {
    l.info.activity = `done · couldn't open on laptop: ${(e as Error).message}`;
  }
  publish();
}

/** "open on laptop" from the lens. */
export async function openSessionOnDesk(id: string): Promise<string> {
  const l = live.get(id);
  const info = l?.info ?? externalList().find((s) => s.id === id);
  if (!info) throw new Error('session not found');
  if (['starting', 'running', 'waiting'].includes(info.status)) throw new Error('still working: open it when this step is done');
  const d = deskOf(id);
  if (d) {
    await openOnDesk(id, l?.saved.worktree || info.cwd, d); // brings it to the front
    return `already open in a ${deskName(d)}. If it's out of date, close it and pinch again`;
  }
  if (l) await letGo(l);
  return openOnDesk(id, l?.saved.worktree || info.cwd);
}

export async function interruptSession(id: string) {
  await live.get(id)?.q?.interrupt().catch(() => undefined);
}

export function stopSession(id: string) {
  const l = live.get(id);
  if (!l) return;
  l.inbox?.close();
  l.abort?.abort();
  l.info.status = 'stopped';
  l.info.activity = 'stopped · send a message to resume';
  publish();
}

/** Sessions "all" means: working right now, or open and waiting for you. Never wakes stopped or idle-elsewhere ones. */
export function activeIds(): string[] {
  const busy = ['starting', 'running', 'waiting'];
  return allSessions()
    .filter((s) => busy.includes(s.status) || (s.source === 'shell' && s.status === 'idle' && Boolean(live.get(s.id)?.q)))
    .map((s) => s.id);
}

export function askAll(target: 'all' | string, text: string) {
  const ids = target === 'all' ? activeIds() : [target];
  if (!ids.length) throw new Error('No active sessions. Open one to send it a message.');
  for (const id of ids) sendToSession(id, text);
}

export function allSessions() {
  return [...[...live.values()].map((l) => l.info), ...externalList()];
}

/**
 * Continue an outside Claude Code session (terminal, VS Code, Remote Control) from the glasses,
 * IN PLACE: same session ID, same conversation, same folder, same row on the lens. The relay resumes
 * it while it's idle there. If you pick it up again at your desk, its hooks hand it back
 * (releaseAdopted), so it never shows twice.
 */
export function continueExternal(ext: SessionInfo, text: string): string {
  const id = ext.id; // the Claude session ID
  const saved: Saved = {
    id, name: ext.name, repo: ext.repo, branch: ext.branch, worktree: ext.cwd ?? '', base: '',
    sdkSessionId: id, startedAt: ext.startedAt, context: ext.context, kind: ext.kind, adopted: true,
  };
  const l: Live = {
    saved, inbox: null, q: null, abort: null,
    info: { ...ext, source: 'shell', status: 'starting', activity: 'continuing', transcript: [...ext.transcript] },
  };
  live.set(id, l);
  persist();
  log(l, 'you', text);
  spawn(l, text);
  publish();
  return id;
}

/**
 * A hook arrived for a session the relay continued: you picked it up again elsewhere. Give it back
 * (returns its info so the outside view keeps the transcript). Returns null if the relay is still
 * running it right now, or doesn't have it.
 */
export function releaseAdopted(sdkId: string): SessionInfo | null {
  const l = live.get(sdkId);
  if (!l?.saved.adopted) return null;
  if (l.q && ['starting', 'running', 'waiting'].includes(l.info.status)) return null;
  l.inbox?.close();
  live.delete(sdkId);
  persist();
  return l.info;
}
