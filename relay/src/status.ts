import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SessionInfo, StatusReport } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { state } from './hub.ts';

/**
 * "How's everything going?" — one glanceable report across every session.
 * Builds a plain summary from session state, then (if Claude is configured)
 * asks a small model to turn it into a two-sentence headline. The per-session
 * lines never depend on the model, so the report works offline too.
 */
export async function statusReport(sessions: SessionInfo[]): Promise<StatusReport> {
  const lines = sessions
    .filter((s) => s.status !== 'stopped' || Date.now() - s.lastActivity < 6 * 3600_000)
    .map((s) => ({ session: s.name, status: s.status, text: lineFor(s) }));

  const running = sessions.filter((s) => s.status === 'running').length;
  const waiting = state.approvals.length + state.questions.length;
  let headline =
    sessions.length === 0
      ? 'No sessions yet.'
      : `${running} running · ${waiting} need${waiting === 1 ? 's' : ''} you · ${sessions.filter((s) => s.status === 'idle').length} done`;

  if (config.claudeAvailable && !config.demo && lines.length) {
    try {
      headline = (await summarize(sessions)) || headline;
    } catch {
      /* keep the plain headline */
    }
  }
  return { at: Date.now(), headline, lines };
}

function lineFor(s: SessionInfo): string {
  const todo = s.todos.length ? ` · ${s.todos.filter((t) => t.done).length}/${s.todos.length} steps` : '';
  const diff = s.diffStat.files ? ` · ${s.diffStat.files} files +${s.diffStat.added} −${s.diffStat.removed}` : '';
  return `${s.activity}${todo}${diff}`.slice(0, 140);
}

async function summarize(sessions: SessionInfo[]): Promise<string> {
  const digest = sessions
    .map((s) => {
      const recent = s.transcript.slice(-6).map((t) => `  ${t.role}: ${t.text.slice(0, 200)}`).join('\n');
      return `## ${s.name} [${s.status}] ${lineFor(s)}\n${recent}`;
    })
    .join('\n\n');
  const pending = [
    ...state.approvals.map((a) => `approval: ${a.sessionName} wants to ${a.title}`),
    ...state.questions.map((q) => `question: ${q.sessionName} asks "${q.question}"`),
  ].join('\n');

  const q = query({
    prompt: `Summarize these coding sessions for someone glancing at smart glasses. At most 2 short sentences, under 160 characters total. Lead with anything that needs them. No markdown.\n\n${digest}\n\nWaiting on the user:\n${pending || 'nothing'}`,
    options: { model: config.statusModel, maxTurns: 1, allowedTools: [], tools: [], settingSources: [] },
  });
  let out = '';
  for await (const m of q) {
    if (m.type === 'result' && m.subtype === 'success') out = m.result;
  }
  return out.trim().slice(0, 200);
}
