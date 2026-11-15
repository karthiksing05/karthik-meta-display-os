import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SessionInfo, StatusReport } from '../../shared/protocol.ts';
import { claudeEnv, config } from './config.ts';
import { state } from './hub.ts';
import { load, save } from './store.ts';
import { sdkTargetOf } from './sessions.ts';

/**
 * "How's everything going?": a short overview plus a summary of EVERY session, ordered
 * needs you → working → your turn → earlier (newest first within each group), and benchmarked
 * against the previous check: what moved, finished, started or got stuck since then.
 *
 * First every recent session is asked directly ("status check: where are you, what's next?"). The
 * question goes to a throwaway fork of the session: Claude with that session's whole memory, but the
 * fork is never saved, so the real session gets no extra message, isn't interrupted, and laptop tabs
 * don't go stale. Those answers are what the summary is written from (plus the last messages).
 *
 * A small model writes it in one call. Without it (offline, demo, error) each line falls back to the
 * session's own activity, and "since last" to plain status changes, so the report always works.
 * The previous report is kept in DATA_DIR/last-status.json (never in ~/.claude/projects).
 */
const RANK: Record<string, number> = { waiting: 1, running: 1, starting: 1, idle: 2, done: 2, error: 2, stopped: 3 };
type Line = StatusReport['lines'][number];

export async function statusReport(sessions: SessionInfo[]): Promise<StatusReport> {
  const prev = load<StatusReport | null>('last-status', null);
  const prevById = new Map((prev?.lines ?? []).map((l) => [l.id, l]));

  const pending = new Map<string, string>();
  for (const a of state.approvals) if (!pending.has(a.sessionId)) pending.set(a.sessionId, `approve: ${a.title}`);
  for (const q of state.questions) if (!pending.has(q.sessionId)) pending.set(q.sessionId, `asks: ${q.question}`);
  const needs = (s: SessionInfo) => pending.has(s.id) || s.status === 'waiting';
  const rank = (s: SessionInfo) => (needs(s) ? 0 : RANK[s.status] ?? 3);
  const ordered = [...sessions].sort((a, b) => rank(a) - rank(b) || b.lastActivity - a.lastActivity);

  const lines: Line[] = ordered.map((s) => ({
    id: s.id,
    session: s.name,
    status: s.status,
    needsYou: needs(s),
    text: (pending.get(s.id) ?? lineFor(s)).slice(0, 320),
    change: plainChange(s, prevById.get(s.id), prev),
  }));

  const waiting = lines.filter((l) => l.needsYou).length;
  const running = ordered.filter((s) => s.status === 'running' || s.status === 'starting').length;
  let headline = sessions.length ? `${waiting} need${waiting === 1 ? 's' : ''} you · ${running} running · ${sessions.length - waiting - running} other` : 'No sessions yet.';

  if (config.claudeAvailable && !config.demo && ordered.length) {
    try {
      const answers = await askSessions(ordered);
      const out = await summarize(ordered, pending, prev, prevById, answers);
      if (out.headline) headline = out.headline;
      lines.forEach((l, i) => {
        const t = out.lines.get(i + 1);
        if (t?.now) l.text = t.now.slice(0, 320);
        if (t?.since) l.change = t.since.slice(0, 200);
      });
    } catch {
      /* keep the plain lines */
    }
  }
  const report: StatusReport = { at: Date.now(), headline, lines, previousAt: prev?.at };
  save('last-status', report);
  return report;
}

function lineFor(s: SessionInfo): string {
  const todo = s.todos.length ? ` · ${s.todos.filter((t) => t.done).length}/${s.todos.length} steps` : '';
  const diff = s.diffStat.files ? ` · ${s.diffStat.files} files +${s.diffStat.added} −${s.diffStat.removed}` : '';
  return `${s.activity || s.repo}${todo}${diff}`;
}

/** Without the model: just the status change since the last check, if any. */
function plainChange(s: SessionInfo, before: Line | undefined, prev: StatusReport | null): string | undefined {
  if (!prev) return undefined;
  if (!before) return s.startedAt > prev.at ? 'new since last check' : 'not in the last check';
  if (before.status !== s.status) return `was ${before.status}, now ${s.status}`;
  if (s.lastActivity <= prev.at) return 'no change';
  return undefined;
}

const agoWords = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};

const ASK =
  'Status check from the user, who is reading on smart glasses. Answer from what you already know; ' +
  "don't use any tools and don't change anything. In 2-4 plain sentences, no markdown: what you're working on " +
  'and how far along it is, what is done, what is next, and anything blocking or needing the user.';
const ASK_TIMEOUT_MS = 60_000;
const ASK_MAX = 8; // sessions asked per check (most recent first); older ones are summarized from their messages
const ASK_PARALLEL = 4;

/** Ask each recent session for its own status, in a fork that's never saved. Returns id → answer. */
async function askSessions(sessions: SessionInfo[]): Promise<Map<string, string>> {
  const day = Date.now() - 24 * 3600_000;
  const targets = sessions
    .filter((s) => s.status !== 'stopped' || s.lastActivity > day)
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, ASK_MAX)
    .flatMap((s) => {
      const t = sdkTargetOf(s);
      return t ? [{ s, ...t }] : [];
    });
  const answers = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const t = targets[next++];
      const text = await askOne(t.sdkId, t.cwd).catch((e) => {
        console.warn(`[status] couldn't ask ${t.s.name}:`, (e as Error).message);
        return '';
      });
      if (text) answers.set(t.s.id, text.replace(/\s+/g, ' ').trim().slice(0, 900));
    }
  };
  await Promise.all(Array.from({ length: ASK_PARALLEL }, worker));
  return answers;
}

async function askOne(sdkId: string, cwd: string): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ASK_TIMEOUT_MS);
  try {
    const q = query({
      prompt: ASK,
      options: {
        resume: sdkId,
        forkSession: true, // a copy: the real session is untouched
        persistSession: false, // and the copy is never written to ~/.claude/projects
        cwd,
        model: config.statusModel,
        maxTurns: 1,
        // The history has tool calls, so tools stay defined, but none may run.
        canUseTool: async () => ({ behavior: 'deny', message: 'Status check: answer from memory, no tools.' }),
        settingSources: [], // no hooks: the fork must not show up as a session on the lens
        abortController: abort,
        env: claudeEnv(),
      },
    });
    let text = '';
    for await (const m of q) {
      if (m.type === 'assistant')
        for (const b of (m.message.content as any[]) ?? []) if (b.type === 'text') text += b.text;
      if (m.type === 'result') break;
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function summarize(
  sessions: SessionInfo[],
  pending: Map<string, string>,
  prev: StatusReport | null,
  prevById: Map<string, Line>,
  answers: Map<string, string>,
) {
  const digest = sessions
    .map((s, i) => {
      const own = answers.get(s.id);
      const recent = s.transcript.slice(own ? -2 : -6).map((t) => `  ${t.role}: ${t.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
      const wait = pending.get(s.id) ? `\n  WAITING ON USER: ${pending.get(s.id)}` : '';
      const before = prevById.get(s.id);
      const last = !prev ? '' : before ? `\n  LAST CHECK: [${before.status}] ${before.text}` : '\n  LAST CHECK: (not listed then)';
      const said = own ? `\n  ITS OWN STATUS ANSWER (asked just now): ${own}` : '';
      return `${i + 1}. ${s.name} (${s.repo}) [${s.status}] ${lineFor(s)}${wait}${last}${said}\n${recent}`;
    })
    .join('\n\n');

  const since = prev
    ? `The previous check was ${agoWords(Date.now() - prev.at)} ago. Its overview said: "${prev.headline}". ` +
      `Benchmark against it: say what moved forward, finished, started, stalled or newly needs the user since then. ` +
      `Only claim a change when a session's LAST CHECK line differs from what it shows now; if little time passed or ` +
      `nothing differs, say plainly that nothing has changed since the last check.\n`
    : 'There is no previous check to compare with.\n';

  const q = query({
    prompt:
      `You are summarizing Claude Code sessions for someone reading on smart glasses (they can scroll). No markdown.\n` +
      since +
      `Line 1: "0: " + an overview in 2-3 short sentences (under 300 characters): first anything waiting on the user ` +
      `(only sessions marked WAITING ON USER count), then overall progress${prev ? ' since the last check' : ''}, then what's next.\n` +
      `Then one line per session, same numbers, in the form "N: <now> | <since>":\n` +
      `  <now> = 1-2 sentences (under 220 characters): what it did or is doing, the outcome so far, and for WAITING ON USER exactly what is needed. ` +
        `When a session has ITS OWN STATUS ANSWER, base <now> on that: it's the session's own account and more current than its messages.\n` +
      `  <since> = ${prev ? 'what changed since the last check, in under 90 characters ("no change" if nothing did; "new" if it wasn\'t listed)' : '"-"'}.\n` +
      `Refer to sessions by name, never by number. Don't restate the status word (running/stopped); it's shown separately.\n\n${digest}`,
    // persistSession: false = nothing is saved to ~/.claude/projects, so these never pile up in your
    // session lists (or on the lens). Older saved ones are deleted by external.ts.
    options: { model: config.statusModel, maxTurns: 1, allowedTools: [], tools: [], settingSources: [], persistSession: false, env: claudeEnv() },
  });
  let raw = '';
  for await (const m of q) if (m.type === 'result' && m.subtype === 'success') raw = m.result;

  const lines = new Map<number, { now: string; since?: string }>();
  let headline = '';
  for (const l of raw.split('\n')) {
    const m = l.match(/^\s*(\d+)\s*[:.)\-]\s*(.+)$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n === 0) {
      headline = m[2].trim();
      continue;
    }
    const cut = m[2].lastIndexOf(' | ');
    const now = (cut > 0 ? m[2].slice(0, cut) : m[2]).trim();
    const sinceText = cut > 0 ? m[2].slice(cut + 3).trim() : '';
    lines.set(n, { now, since: sinceText && sinceText !== '-' ? sinceText : undefined });
  }
  return { headline: headline.slice(0, 400), lines };
}
