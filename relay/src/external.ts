import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { deleteSession, getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { SessionInfo, TranscriptItem } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { hub, state } from './hub.ts';
import { previewFor, ruleFor, titleFor } from './approvals.ts';
import { continueExternal, ownsSdkSession, publish, releaseAdopted } from './sessions.ts';

/**
 * Every other Claude Code session on this machine: terminal, VS Code, and Remote Control
 * (which runs the normal CLI here). Two sources:
 *
 *  - Hooks (installed with `npm run hooks -w relay -- install`) POST each event to /hooks:
 *    prompts, tool use, permission requests, stops. That gives live status, and lets you
 *    approve or answer from the glasses.
 *  - listSessions() from the Agent SDK, for recent sessions from before the hooks were installed.
 *
 * What you can do from the lens:
 *  - approve / deny a permission request (only held while the glasses are connected, so a
 *    session you're driving from the desk isn't kept waiting)
 *  - answer AskUserQuestion
 *  - send a message: if the session is mid-task, it's delivered when Claude next stops (the Stop
 *    hook hands it over and Claude keeps going). If it's idle, the relay continues the SAME session
 *    in place (same ID and conversation); picking it up again at your desk hands it back.
 */

const MAX_TRANSCRIPT = 40;
const SEED_WINDOW = 24 * 3600_000;
/** How long a permission request waits for the glasses before falling back to the normal prompt. */
const APPROVAL_WAIT = 10 * 60_000;

interface Ext {
  info: SessionInfo;
  /** Messages from the glasses waiting for the session's next Stop. */
  outbox: string[];
}

const ext = new Map<string, Ext>(); // keyed by Claude session ID
const pendingApprovals = new Map<string, (d: 'allow' | 'deny' | 'always') => void>();
const pendingQuestions = new Map<string, (a: Record<string, string>) => void>();

export const externalList = () => [...ext.values()].map((e) => e.info);

export function forgetExternal(sdkId: string) {
  if (ext.delete(sdkId)) publish();
}

const under = (dir: string, p?: string) => Boolean(p && (p === dir || p.startsWith(dir + path.sep)));

/** Sessions the relay runs itself: its worktrees, and sessions it's continuing right now. */
function isOwn(sdkId: string, cwd: string | undefined) {
  return under(config.worktreesDir, cwd) || ownsSdkSession(sdkId);
}

/** The "how's everything going?" summaries from older versions were saved as sessions: clear them out. */
const STATUS_PROMPT_PREFIXES = ['Summarize these coding sessions for someone glancing', 'Summarize these Claude sessions for someone glancing', 'You are summarizing Claude Code sessions for someone reading'];
const isStatusPrompt = (t: string) => STATUS_PROMPT_PREFIXES.some((p) => t.startsWith(p));

function repoLabel(cwd: string) {
  if (cwd.includes('/Library/Application Support/Claude/')) return 'claude app';
  if (under(config.chatsDir, cwd)) return 'chat';
  return path.basename(cwd) || '~';
}

function upsert(sdkId: string, cwd: string, patch: Partial<SessionInfo> = {}): Ext {
  let e = ext.get(sdkId);
  if (!e) {
    e = {
      outbox: [],
      info: {
        id: sdkId, name: repoLabel(cwd), repo: repoLabel(cwd), branch: '', status: 'idle',
        source: 'external', cwd, kind: under(config.chatsDir, cwd) ? 'chat' : 'code',
        startedAt: Date.now(), lastActivity: Date.now(), activity: '',
        progress: null, todos: [], diffStat: { files: 0, added: 0, removed: 0 }, transcript: [], costUsd: 0,
      },
    };
    ext.set(sdkId, e);
  }
  Object.assign(e.info, patch);
  return e;
}

function log(e: Ext, role: TranscriptItem['role'], text: string) {
  if (!text?.trim()) return;
  e.info.transcript.push({ at: Date.now(), role, text: text.slice(0, 2000) });
  if (e.info.transcript.length > MAX_TRANSCRIPT) e.info.transcript.splice(0, e.info.transcript.length - MAX_TRANSCRIPT);
  e.info.lastActivity = Date.now();
}

const firstLine = (s: string, n = 90) => s.trim().split('\n')[0].slice(0, n);

// ---------- seed from the SDK's session list ----------

function textOf(message: unknown): { text: string; tools: string[] } {
  const m = message as { content?: unknown };
  if (typeof m?.content === 'string') return { text: m.content, tools: [] };
  const blocks = Array.isArray(m?.content) ? (m.content as any[]) : [];
  return {
    text: blocks.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n'),
    tools: blocks.filter((b) => b?.type === 'tool_use').map((b) => String(b.name ?? 'tool')),
  };
}

async function loadTranscript(e: Ext) {
  try {
    const msgs = await getSessionMessages(e.info.id, { dir: e.info.cwd });
    const items: TranscriptItem[] = [];
    for (const m of msgs.slice(-60)) {
      if (m.parent_tool_use_id) continue; // subagent chatter
      const { text, tools } = textOf(m.message);
      if (m.type === 'user' && text && !/^\s*(<|\[Request interrupted|Caveat:)/.test(text)) items.push({ at: e.info.lastActivity, role: 'you', text: text.slice(0, 2000) });
      if (m.type === 'assistant') {
        if (text) items.push({ at: e.info.lastActivity, role: 'claude', text: text.slice(0, 2000) });
        for (const t of tools) items.push({ at: e.info.lastActivity, role: 'tool', text: `use ${t}` });
      }
    }
    if (!e.info.transcript.length) e.info.transcript = items.slice(-12);
  } catch {
    /* transcript format is internal; the list still works without it */
  }
}

export async function seedExternal() {
  try {
    const list = await listSessions({ limit: 40 });
    const fresh: Ext[] = [];
    for (const s of list) {
      const first = s.firstPrompt || s.summary || '';
      if (isStatusPrompt(first) || isStatusPrompt(s.summary ?? '')) {
        deleteSession(s.sessionId, { dir: s.cwd }).catch(() => undefined);
        continue;
      }
      if (Date.now() - s.lastModified > SEED_WINDOW || !s.cwd || isOwn(s.sessionId, s.cwd)) continue;
      const known = ext.has(s.sessionId);
      const e = upsert(s.sessionId, s.cwd);
      e.info.name = firstLine(s.customTitle || s.summary || s.firstPrompt || e.info.name, 48);
      e.info.branch = s.gitBranch ?? e.info.branch;
      if (!known) {
        e.info.startedAt = s.createdAt ?? s.lastModified;
        e.info.lastActivity = s.lastModified;
        e.info.status = 'stopped';
        e.info.activity = 'no live updates yet · send a message to continue it here';
        fresh.push(e);
      }
    }
    await Promise.all(fresh.slice(0, 12).map(loadTranscript));
    publish();
  } catch (err) {
    console.warn('[external] listSessions failed:', (err as Error).message);
  }
}

// ---------- hooks ----------

interface HookIn {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  prompt?: string;
  session_title?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  message?: string;
  notification_type?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
  source?: string;
  reason?: string;
}

/** Handle one hook event; the returned object is the hook's JSON output ({} = no decision). */
export async function handleHook(h: HookIn): Promise<object> {
  if (!h?.session_id || !h.hook_event_name) return {};
  // The relay's own processes never send hooks (hook.sh skips them). So a hook for a session the relay
  // continued means you picked it up again elsewhere: hand it back and keep its history.
  if (ownsSdkSession(h.session_id)) {
    const back = releaseAdopted(h.session_id);
    if (!back) return {};
    ext.set(h.session_id, { outbox: [], info: { ...back, source: 'external', activity: 'picked up again elsewhere' } });
  } else if (isOwn(h.session_id, h.cwd)) return {};
  const cwd = h.cwd ?? ext.get(h.session_id)?.info.cwd ?? '';
  const e = upsert(h.session_id, cwd);
  if (h.session_title) e.info.name = firstLine(h.session_title, 48);

  try {
    switch (h.hook_event_name) {
      case 'SessionStart':
        e.info.status = 'idle';
        e.info.activity = h.source === 'resume' ? 'resumed' : 'started';
        e.info.lastActivity = Date.now();
        return {};

      case 'UserPromptSubmit':
        if (e.info.name === path.basename(cwd) && h.prompt) e.info.name = firstLine(h.prompt, 48);
        e.info.status = 'running';
        e.info.activity = `working on: ${firstLine(h.prompt ?? '', 70)}`;
        log(e, 'you', h.prompt ?? '');
        return {};

      case 'PreToolUse': {
        const tool = h.tool_name ?? 'tool';
        const input = h.tool_input ?? {};
        e.info.status = 'running';
        e.info.activity = titleFor(tool, input, cwd);
        log(e, 'tool', e.info.activity);
        if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
          e.info.todos = (input.todos as any[]).map((x) => ({ text: String(x.content ?? x.activeForm ?? ''), done: x.status === 'completed' }));
          e.info.progress = e.info.todos.length ? e.info.todos.filter((x) => x.done).length / e.info.todos.length : null;
        }
        return {};
      }

      case 'PermissionRequest':
        return await permission(e, h.tool_name ?? 'tool', h.tool_input ?? {});

      case 'Notification':
        if (h.notification_type === 'idle_prompt') {
          e.info.status = 'idle';
          e.info.activity = 'waiting for you';
        } else if (h.notification_type !== 'permission_prompt' && h.message) {
          hub.broadcast({ t: 'notify', text: `${e.info.name}: ${h.message}`.slice(0, 120), level: 'info', sessionId: e.info.id });
        }
        return {};

      case 'Stop': {
        if (h.last_assistant_message) {
          log(e, 'claude', h.last_assistant_message);
          e.info.activity = firstLine(h.last_assistant_message);
        }
        const next = e.outbox.shift();
        if (next) {
          e.info.status = 'running';
          log(e, 'system', 'delivered your message from the glasses');
          return { decision: 'block', reason: `Message from the user, sent from their glasses: ${next}` };
        }
        e.info.status = 'idle';
        hub.broadcast({ t: 'notify', text: `${e.info.name}: done`, level: 'good', sessionId: e.info.id });
        return {};
      }

      case 'SessionEnd':
        e.info.status = 'stopped';
        e.info.activity = 'ended · send a message to continue it here';
        return {};
    }
    return {};
  } finally {
    publish();
  }
}

async function permission(e: Ext, tool: string, input: Record<string, unknown>): Promise<object> {
  // Nobody's looking at the lens: let the normal prompt (terminal, VS Code, Claude app) handle it.
  if (hub.connected === 0) return {};
  const id = randomUUID();
  const prev = e.info.status;
  e.info.status = 'waiting';

  if (tool === 'AskUserQuestion') {
    const qs = (input.questions as any[]) ?? [];
    const answers: Record<string, string> = {};
    for (const q of qs) {
      const a = await new Promise<Record<string, string> | null>((resolve) => {
        const qid = randomUUID();
        state.questions.push({
          id: qid, sessionId: e.info.id, sessionName: e.info.name, header: q.header ?? 'question',
          question: q.question, options: q.options ?? [], multiSelect: Boolean(q.multiSelect), at: Date.now(),
        });
        e.info.activity = `asks: ${String(q.question).slice(0, 80)}`;
        publish();
        hub.broadcast({ t: 'notify', text: `${e.info.name} asks a question`, level: 'warn', sessionId: e.info.id });
        const done = (v: Record<string, string> | null) => {
          clearTimeout(timer);
          pendingQuestions.delete(qid);
          state.questions = state.questions.filter((x) => x.id !== qid);
          resolve(v);
        };
        const timer = setTimeout(() => done(null), APPROVAL_WAIT);
        pendingQuestions.set(qid, done);
      });
      if (!a) {
        e.info.status = prev;
        return {}; // timed out: falls back to the normal question UI
      }
      answers[q.question] = Object.values(a)[0] ?? '';
      log(e, 'you', answers[q.question]);
    }
    e.info.status = 'running';
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { ...input, answers } } } };
  }

  if (state.settings.approvals === 'everything') {
    e.info.status = 'running';
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
  }
  const title = titleFor(tool, input, e.info.cwd ?? '');
  e.info.activity = `needs you: ${title}`;
  state.approvals.push({ id, sessionId: e.info.id, sessionName: e.info.name, tool, title, alwaysLabel: ruleFor(tool, input), at: Date.now(), ...previewFor(tool, input) });
  publish();
  hub.broadcast({ t: 'notify', text: `${e.info.name} needs approval`, level: 'warn', sessionId: e.info.id });

  const decision = await new Promise<'allow' | 'deny' | 'always' | null>((resolve) => {
    const timer = setTimeout(() => done(null), APPROVAL_WAIT);
    const done = (d: 'allow' | 'deny' | 'always' | null) => {
      clearTimeout(timer);
      pendingApprovals.delete(id);
      resolve(d);
    };
    pendingApprovals.set(id, done);
  });
  state.approvals = state.approvals.filter((a) => a.id !== id);
  e.info.status = decision === 'deny' ? prev : 'running';
  e.info.activity = decision ? title : `${title} · answered elsewhere`;
  publish();
  if (!decision) return {};
  if (decision === 'deny') {
    log(e, 'system', `denied on the glasses: ${title}`);
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'The user declined this on their glasses.' } } };
  }
  log(e, 'system', `approved on the glasses: ${title}`);
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
}

// ---------- commands from the glasses ----------

export function externalDecide(approvalId: string, d: 'allow' | 'deny' | 'always') {
  const fn = pendingApprovals.get(approvalId);
  fn?.(d);
  return Boolean(fn);
}

export function externalAnswer(questionId: string, answers: Record<string, string>) {
  const fn = pendingQuestions.get(questionId);
  fn?.(answers);
  return Boolean(fn);
}

export function externalSend(sdkId: string, text: string) {
  const e = ext.get(sdkId);
  if (!e) return;
  if (e.info.status === 'running' || e.info.status === 'waiting') {
    e.outbox.push(text);
    log(e, 'you', `${text}  (queued: delivered when it finishes this step)`);
    publish();
    return;
  }
  if (!config.claudeAvailable) throw new Error('Claude is not configured on the relay (see relay/.env)');
  // Idle or ended: the relay continues this same session in place (same ID, same row).
  ext.delete(sdkId);
  continueExternal(e.info, text);
}
