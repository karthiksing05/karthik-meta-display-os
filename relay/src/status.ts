import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SessionInfo, StatusReport } from '../../shared/protocol.ts';
import { claudeEnv, config } from './config.ts';
import { state } from './hub.ts';

/**
 * "How's everything going?" — a headline plus a one-line summary of EVERY session, ordered:
 * needs you → working → your turn → earlier (newest first within each group).
 * A small model writes the headline and the per-session lines in one call; without it (offline,
 * demo, error) each line falls back to the session's own activity, so the report always works.
 */
const RANK: Record<string, number> = { waiting: 1, running: 1, starting: 1, idle: 2, done: 2, error: 2, stopped: 3 };

export async function statusReport(sessions: SessionInfo[]): Promise<StatusReport> {
  const pending = new Map<string, string>();
  for (const a of state.approvals) if (!pending.has(a.sessionId)) pending.set(a.sessionId, `approve: ${a.title}`);
  for (const q of state.questions) if (!pending.has(q.sessionId)) pending.set(q.sessionId, `asks: ${q.question}`);
  const needs = (s: SessionInfo) => pending.has(s.id) || s.status === 'waiting';
  const rank = (s: SessionInfo) => (needs(s) ? 0 : RANK[s.status] ?? 3);
  const ordered = [...sessions].sort((a, b) => rank(a) - rank(b) || b.lastActivity - a.lastActivity);

  const lines = ordered.map((s) => ({
    id: s.id,
    session: s.name,
    status: s.status,
    needsYou: needs(s),
    text: (pending.get(s.id) ?? lineFor(s)).slice(0, 160),
  }));

  const waiting = lines.filter((l) => l.needsYou).length;
  const running = ordered.filter((s) => s.status === 'running' || s.status === 'starting').length;
  let headline = sessions.length ? `${waiting} need${waiting === 1 ? 's' : ''} you · ${running} running · ${sessions.length - waiting - running} other` : 'No sessions yet.';

  if (config.claudeAvailable && !config.demo && ordered.length) {
    try {
      const out = await summarize(ordered, pending);
      if (out.headline) headline = out.headline;
      lines.forEach((l, i) => {
        const t = out.lines.get(i + 1);
        if (t) l.text = t.slice(0, 160);
      });
    } catch {
      /* keep the plain lines */
    }
  }
  return { at: Date.now(), headline, lines };
}

function lineFor(s: SessionInfo): string {
  const todo = s.todos.length ? ` · ${s.todos.filter((t) => t.done).length}/${s.todos.length} steps` : '';
  const diff = s.diffStat.files ? ` · ${s.diffStat.files} files +${s.diffStat.added} −${s.diffStat.removed}` : '';
  return `${s.activity || s.repo}${todo}${diff}`;
}

async function summarize(sessions: SessionInfo[], pending: Map<string, string>) {
  const digest = sessions
    .map((s, i) => {
      const recent = s.transcript.slice(-4).map((t) => `  ${t.role}: ${t.text.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
      const wait = pending.get(s.id) ? `\n  WAITING ON USER: ${pending.get(s.id)}` : '';
      return `${i + 1}. ${s.name} (${s.repo}) [${s.status}] ${lineFor(s)}${wait}\n${recent}`;
    })
    .join('\n\n');

  const q = query({
    prompt:
      `Summarize these Claude sessions for someone glancing at smart glasses. No markdown.\n` +
      `Line 1: "0: " + a headline, at most 120 characters. Only sessions marked WAITING ON USER are waiting on ` +
      `the user; lead with those if any, otherwise say what's running and what finished.\n` +
      `Then one line per session, same numbers: "N: " + where it stands, under 100 characters: the outcome ` +
      `or current step, and for WAITING ON USER exactly what is needed. Don't restate the status word ` +
      `(running/stopped) — it's shown separately.\n\n${digest}`,
    // persistSession: false = nothing is saved to ~/.claude/projects, so these never pile up in your
    // session lists (or on the lens). Older saved ones are deleted by external.ts.
    options: { model: config.statusModel, maxTurns: 1, allowedTools: [], tools: [], settingSources: [], persistSession: false, env: claudeEnv() },
  });
  let raw = '';
  for await (const m of q) if (m.type === 'result' && m.subtype === 'success') raw = m.result;

  const lines = new Map<number, string>();
  for (const l of raw.split('\n')) {
    const m = l.match(/^\s*(\d+)\s*[:.)\-]\s*(.+)$/);
    if (m) lines.set(Number(m[1]), m[2].trim());
  }
  return { headline: (lines.get(0) ?? '').slice(0, 200), lines };
}
