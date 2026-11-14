import { execFile } from 'node:child_process';

/**
 * Your laptop's own Claude windows ("the desk"): which sessions have a VS Code tab or terminal open
 * right now, and opening a session there so it shows everything the glasses did.
 *
 * Why this exists: an open VS Code tab or terminal never re-reads its conversation from disk. If the
 * glasses continue a session while it's open there, that window is out of date until it's closed and
 * opened again. A session that ISN'T open loads fresh, with every turn, when you open it.
 *
 * Detection:
 *  - VS Code: each Claude tab runs the extension's own `claude … --resume=<id>` process.
 *  - Terminal (and VS Code tabs that started fresh): the hook script sends its parent process ID,
 *    so we remember which process belongs to which session and check it's still alive.
 */
export type Desk = 'vscode' | 'terminal';

const run = (cmd: string, args: string[]) =>
  new Promise<string>((res) => execFile(cmd, args, { timeout: 5000, maxBuffer: 4 << 20 }, (_e, out) => res(String(out ?? ''))));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
/** session id → process id, learned from hooks. */
const hookPids = new Map<string, number>();
/** session id → where it's open now. */
let open = new Map<string, Desk>();
/** session id → where it was last seen open (to reopen it in the same place). */
const lastDesk = new Map<string, Desk>();

let onChange: () => void = () => {};
export const onDeskChange = (fn: () => void) => (onChange = fn);

export const deskOf = (id: string): Desk | undefined => open.get(id);

/** Called for every hook: `pid` is the hook's parent (the claude process, or a shell right under it). */
export function notePid(sessionId: string, pid: number) {
  if (sessionId && Number.isInteger(pid) && pid > 1) hookPids.set(sessionId, pid);
}

const isClaude = (args: string) => /(^|\/)claude(\s|$)/.test(args.split(' ')[0] ?? '') || /native-binary\/claude/.test(args);
/** One-shot `claude -p` runs (scripts, the SDK) aren't windows you look at. */
const headless = (args: string) => /\s(-p|--print)(\s|$)/.test(args) || /--output-format[= ]stream-json/.test(args) && !args.includes('anthropic.claude-code');
const kindOf = (args: string): Desk => (args.includes('anthropic.claude-code') ? 'vscode' : 'terminal');

export async function scanDesk() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;
  const out = await run('ps', ['-axo', 'pid=,ppid=,args=']);
  const procs = new Map<number, { ppid: number; args: string }>();
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), args: m[3] });
  }
  const next = new Map<string, Desk>();
  // VS Code tabs that resumed a session carry its id.
  for (const p of procs.values()) {
    if (!p.args.includes('anthropic.claude-code') || !isClaude(p.args)) continue;
    const id = p.args.match(new RegExp(`--resume[= ](${UUID.source})`))?.[1];
    if (id) next.set(id, 'vscode');
  }
  // Sessions we learned a process for through hooks (terminal, or VS Code tabs started fresh).
  for (const [id, pid] of hookPids) {
    let p = procs.get(pid);
    if (p && !isClaude(p.args)) p = procs.get(p.ppid); // hook ran under a shell: step up once
    if (!p || !isClaude(p.args)) {
      hookPids.delete(id);
      continue;
    }
    if (headless(p.args)) continue;
    if (!next.has(id)) next.set(id, kindOf(p.args));
  }
  for (const [id, d] of next) lastDesk.set(id, d);
  const changed = next.size !== open.size || [...next].some(([k, v]) => open.get(k) !== v);
  open = next;
  if (changed) onChange();
}

/** Wait (up to `ms`) until the session has no open window/process on the laptop. */
export async function waitClosed(id: string, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await scanDesk();
    if (!open.has(id)) return true;
    await sleep(400);
  }
  return false;
}

/**
 * Open the session on the laptop where it was last used (VS Code by default). VS Code resumes a
 * session only from the folder open in that window, so open the folder first, then the session.
 */
export async function openOnDesk(id: string, cwd: string | undefined, prefer?: Desk): Promise<string> {
  const where = prefer ?? lastDesk.get(id) ?? 'vscode';
  if (where === 'vscode') {
    if (cwd) {
      await run('open', ['-g', '-a', 'Visual Studio Code', cwd]);
      await sleep(1500);
    }
    await run('open', ['-g', `vscode://anthropic.claude-code/open?session=${encodeURIComponent(id)}`]);
    return 'opened in VS Code';
  }
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const cmd = `${cwd ? `cd ${q(cwd)} && ` : ''}claude --resume ${id}`;
  await run('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(cmd)}`]);
  return 'opened in Terminal';
}

export function startDeskWatch() {
  scanDesk();
  setInterval(scanDesk, 5000).unref();
}
