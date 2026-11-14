import { query, type Query, type SDKMessage, type SDKUserMessage, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SessionInfo, TranscriptItem } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { hub, state } from './hub.ts';
import { load, save } from './store.ts';
import { decide, previewFor, ruleFor, titleFor } from './approvals.ts';
import { glassesMcp, GLASSES_PROMPT } from './glassesMcp.ts';

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
  costUsd: number;
}

interface Live {
  info: SessionInfo;
  saved: Saved;
  inbox: Inbox | null;
  q: Query | null;
  abort: AbortController | null;
}

const live = new Map<string, Live>();
const pendingApprovals = new Map<string, (r: PermissionResult) => void>();
const pendingQuestions = new Map<string, (answers: Record<string, string>) => void>();

// ---------- repos & worktrees ----------

export function scanRepos(): string[] {
  try {
    return fs
      .readdirSync(config.reposDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(config.reposDir, d.name, '.git')))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'task';
}

async function makeWorktree(repo: string, name: string, id: string) {
  const repoPath = path.join(config.reposDir, repo);
  if (!fs.existsSync(path.join(repoPath, '.git'))) throw new Error(`${repo} is not a git repo in ${config.reposDir}`);
  const branch = `shell/${slug(name)}-${id.slice(0, 4)}`;
  const worktree = path.join(config.worktreesDir, `${repo}-${slug(name)}-${id.slice(0, 4)}`);
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

function publish() {
  state.sessions = [...live.values()]
    .map((l) => l.info)
    .sort((a, b) => b.lastActivity - a.lastActivity);
  hub.changed();
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
        id: s.id, name: s.name, repo: s.repo, branch: s.branch, status: 'stopped',
        startedAt: s.startedAt, lastActivity: s.startedAt, activity: 'stopped · send a message to resume',
        progress: null, todos: [], diffStat: { files: 0, added: 0, removed: 0 }, transcript: [], costUsd: s.costUsd,
      },
    });
  }
  state.repos = scanRepos();
  publish();
}

export async function startSession(repo: string, prompt: string, name?: string): Promise<string> {
  const id = randomUUID();
  const title = name?.trim() || prompt.split(/[.\n]/)[0].slice(0, 40);
  const { branch, worktree, base } = await makeWorktree(repo, title, id);
  const saved: Saved = { id, name: title, repo, branch, worktree, base, sdkSessionId: null, startedAt: Date.now(), costUsd: 0 };
  const l: Live = {
    saved,
    inbox: null,
    q: null,
    abort: null,
    info: {
      id, name: title, repo, branch, status: 'starting', startedAt: saved.startedAt, lastActivity: Date.now(),
      activity: 'starting', progress: null, todos: [], diffStat: { files: 0, added: 0, removed: 0 }, transcript: [], costUsd: 0,
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
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: GLASSES_PROMPT },
      mcpServers: {
        glasses: glassesMcp({
          sessionId: sid,
          sessionName: () => l.info.name,
          ask: (header, question, options) =>
            askQuestion(l, header, question, options.map((label) => ({ label })), false).then(
              (a) => Object.values(a)[0] ?? '',
            ),
        }),
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
        persist();
      }
      break;
    case 'assistant': {
      l.info.status = 'running';
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
      l.info.costUsd = msg.total_cost_usd ?? l.info.costUsd;
      l.saved.costUsd = l.info.costUsd;
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
  pendingQuestions.get(id)?.(answers);
}

export function sendToSession(id: string, text: string) {
  const l = live.get(id);
  if (!l) return;
  log(l, 'you', text);
  if (l.inbox && l.q && !['stopped', 'error'].includes(l.info.status)) {
    l.inbox.push(text);
    l.info.status = 'running';
  } else {
    spawn(l, text); // resumes the saved Claude session
  }
  publish();
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

export function askAll(target: 'all' | string, text: string) {
  const ids = target === 'all' ? [...live.keys()].filter((id) => live.get(id)!.info.status !== 'done') : [target];
  for (const id of ids) sendToSession(id, text);
}

export function allSessions() {
  return [...live.values()].map((l) => l.info);
}
