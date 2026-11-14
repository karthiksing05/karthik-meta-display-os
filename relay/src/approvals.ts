import path from 'node:path';
import type { ApprovalPreset } from '../../shared/protocol.ts';

/**
 * Approval policy: one preset plus the rules you taught it with "↓ always".
 * No rules editor on purpose. To forget rules, use Settings → clear learned.
 *
 *   careful   asks for everything except reading files
 *   balanced  (default) allows reads, edits inside the session's worktree and
 *             a list of safe commands (tests, builds, git status/diff); asks for the rest
 *   trusting  allows everything except the dangerous list
 *
 * Dangerous commands always ask, whatever the preset or learned rules say.
 */

export type Verdict = 'allow' | 'ask';

const READ_ONLY = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'BashOutput', 'ToolSearch', 'WebSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'KillShell', 'TaskStop',
]);
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const DANGEROUS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
  /\bsudo\b/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-z]*f/,
  /\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/,
  /\bchmod\s+-?R?\s*777\b/,
  /\b(mkfs|dd\s+if=|shutdown|reboot)\b/,
  />\s*\/dev\/(sd|disk|nvme)/,
  /\bnpm\s+publish\b/,
  /\b(ssh|scp)\s/,
  /(^|\s)\.env\b/,
];

/** Reads that could leak secrets always ask. */
const SECRET_PATH = /(^|\/)(\.ssh|\.aws|\.gnupg|\.config\/gcloud)(\/|$)|(^|\/)\.env(\.|$)|credentials|id_rsa|id_ed25519/i;

const SAFE_BALANCED: RegExp[] = [
  /^git\s+(status|diff|log|show|branch|rev-parse|ls-files|blame|stash list)\b/,
  /^git\s+(add|commit|checkout -b|switch -c|restore)\b/,
  /^(ls|pwd|cat|head|tail|wc|echo|which|tree|du|file|stat|sort|uniq|diff|true)\b/,
  /^(grep|rg|fd)\b/,
  /^find\b(?!.*(-delete|-exec))/,
  /^(npm|pnpm|yarn|bun)\s+(test|t|run\s+(test|lint|build|typecheck|check|format)|install|i|ci)\b/,
  /^npx\s+(tsc|vitest|jest|eslint|prettier|playwright test)\b/,
  /^(python3?\s+-m\s+)?(pytest|unittest|mypy|ruff|black)\b/,
  /^(cargo\s+(test|build|check|clippy|fmt)|go\s+(test|build|vet|fmt)|make\s+(test|build|lint))\b/,
  /^(node|tsx|python3?)\s+--version\b/,
];

const SAFE_CAREFUL: RegExp[] = [/^git\s+(status|diff|log|show)\b/, /^(ls|pwd|cat|head|tail|wc)\b/];

function segments(cmd: string): string[] {
  return cmd
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim().replace(/^\(+|\)+$/g, '').replace(/^cd\s+\S+\s*$/, 'true'))
    .filter(Boolean);
}

export function isDangerous(cmd: string): boolean {
  return DANGEROUS.some((r) => r.test(cmd));
}

function insideWorktree(file: unknown, worktree: string): boolean {
  if (typeof file !== 'string') return false;
  const abs = path.resolve(worktree, file);
  return abs === worktree || abs.startsWith(worktree + path.sep);
}

/** The rule "↓ always" would store for this call, e.g. `Bash(npm run *)`. */
export function ruleFor(tool: string, input: Record<string, unknown>): string {
  if (tool === 'Bash') {
    const first = segments(String(input.command ?? '')).find((x) => x !== 'true') ?? '';
    const words = first.split(/\s+/);
    const multi = ['npm', 'pnpm', 'yarn', 'bun', 'npx', 'git', 'cargo', 'go', 'make', 'docker', 'python', 'python3', 'uv'];
    const n = multi.includes(words[0]) ? (words[1] === 'run' || words[1] === '-m' ? 3 : 2) : 1;
    return `Bash(${words.slice(0, n).join(' ')} *)`;
  }
  if (tool === 'WebFetch') {
    try {
      return `WebFetch(domain:${new URL(String(input.url)).hostname})`;
    } catch {
      return 'WebFetch';
    }
  }
  return tool;
}

function matchesRule(rule: string, tool: string, input: Record<string, unknown>): boolean {
  const m = /^([^()]+)(?:\((.*)\))?$/.exec(rule);
  if (!m || m[1] !== tool) return false;
  const content = m[2];
  if (!content) return true;
  if (tool === 'Bash') {
    const prefix = content.replace(/\s*\*$/, '');
    return segments(String(input.command ?? '')).every((s) => s === prefix || s.startsWith(prefix + ' '));
  }
  if (tool === 'WebFetch' && content.startsWith('domain:')) {
    try {
      return new URL(String(input.url)).hostname === content.slice(7);
    } catch {
      return false;
    }
  }
  return false;
}

export function decide(
  preset: ApprovalPreset,
  learned: string[],
  tool: string,
  input: Record<string, unknown>,
  worktree: string,
): Verdict {
  if (tool.startsWith('mcp__glasses__')) return 'allow';
  if (tool === 'AskUserQuestion') return 'ask'; // routed to the question inbox, not an approval

  if (tool === 'Bash' && isDangerous(String(input.command ?? ''))) return 'ask';
  if (learned.some((r) => matchesRule(r, tool, input))) return 'allow';

  if (READ_ONLY.has(tool)) {
    const p = String(input.file_path ?? input.path ?? '');
    return SECRET_PATH.test(p) ? 'ask' : 'allow';
  }

  if (EDITS.has(tool)) {
    const inside = insideWorktree(input.file_path ?? input.notebook_path, worktree);
    if (!inside) return 'ask';
    return preset === 'careful' ? 'ask' : 'allow';
  }

  if (tool === 'Bash') {
    const segs = segments(String(input.command ?? ''));
    if (preset === 'trusting') return 'allow';
    const safe = preset === 'careful' ? SAFE_CAREFUL : SAFE_BALANCED;
    return segs.every((s) => safe.some((r) => r.test(s))) ? 'allow' : 'ask';
  }

  return preset === 'trusting' ? 'allow' : 'ask';
}

/** One-line title for the approval card. */
export function titleFor(tool: string, input: Record<string, unknown>, worktree: string): string {
  const rel = (p: unknown) => (typeof p === 'string' ? path.relative(worktree, path.resolve(worktree, p)) || p : '?');
  switch (tool) {
    case 'Bash':
    {
      const d = String(input.description ?? 'a command').toLowerCase();
      return /^(run|start|install|build|test|check|execute)\b/.test(d) ? d : `run ${d}`;
    }
    case 'Edit':
    case 'MultiEdit':
      return `edit ${rel(input.file_path)}`;
    case 'Write':
      return `write ${rel(input.file_path)}`;
    case 'WebFetch':
      return `open ${String(input.url ?? '')}`;
    default:
      return tool.startsWith('mcp__') ? `use ${tool.split('__').slice(1).join(' · ')}` : `use ${tool}`;
  }
}

/** Lens-sized preview: command text or a short diff. */
export function previewFor(tool: string, input: Record<string, unknown>) {
  if (tool === 'Bash') return { detail: String(input.command ?? '').slice(0, 400) };
  if (tool === 'Edit') {
    const diff = [
      ...String(input.old_string ?? '').split('\n').slice(0, 6).map((text) => ({ kind: '-' as const, text })),
      ...String(input.new_string ?? '').split('\n').slice(0, 8).map((text) => ({ kind: '+' as const, text })),
    ];
    return { detail: String(input.file_path ?? ''), diff };
  }
  if (tool === 'Write') {
    const lines = String(input.content ?? '').split('\n');
    return {
      detail: `${input.file_path} · ${lines.length} lines`,
      diff: lines.slice(0, 12).map((text) => ({ kind: '+' as const, text })),
    };
  }
  const s = JSON.stringify(input);
  return { detail: s.length > 400 ? s.slice(0, 400) + '…' : s };
}
