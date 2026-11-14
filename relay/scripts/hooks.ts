import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Show every Claude Code session on this Mac in Claude Shell (terminal, VS Code, Remote Control).
 *
 *   npm run hooks -w relay -- install    add the Claude Shell hooks to ~/.claude/settings.json
 *   npm run hooks -w relay -- remove     take them out again
 *   npm run hooks -w relay -- status
 *
 * The hooks run ~/.claude-shell/hook.sh, which POSTs each event to the relay on localhost.
 * When the relay isn't running it does nothing, silently. The relay's own sessions skip it.
 * Your other hooks and settings are left alone; a backup is written before the first change.
 */
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK = path.join(os.homedir(), '.claude-shell', 'hook.sh');
const ENV_FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '.env');
const MARK = '.claude-shell/hook.sh';

// event → [curl max seconds, hook timeout seconds, matcher?]
const EVENTS: Record<string, [number, number, string?]> = {
  SessionStart: [3, 5],
  UserPromptSubmit: [3, 5],
  PreToolUse: [3, 5, '*'],
  // Waits for your swipe on the glasses (only while the lens is connected), up to 10 min.
  PermissionRequest: [650, 660, '*'],
  Notification: [3, 5],
  Stop: [3, 5],
  SessionEnd: [1, 2],
};

const SCRIPT = `#!/bin/sh
# Claude Shell: forwards Claude Code hook events to the relay.
# Installed by: npm run hooks -w relay -- install   (remove: ... -- remove)
# Does nothing when the relay isn't running, and skips the relay's own sessions.
[ -n "$CLAUDE_SHELL_OWNED" ] && exit 0
ENV_FILE='${ENV_FILE}'
[ -r "$ENV_FILE" ] || exit 0
TOKEN=$(sed -n 's/^SHELL_TOKEN=//p' "$ENV_FILE" | head -1)
PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -1)
curl -sf -m "\${1:-3}" -X POST -H 'content-type: application/json' -H "x-shell-token: $TOKEN" -H "x-claude-pid: $PPID" \\
  --data-binary @- "http://127.0.0.1:\${PORT:-8787}/hooks" 2>/dev/null
exit 0
`;

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]>; [k: string]: unknown };

function read(): Settings {
  if (!fs.existsSync(SETTINGS)) return {};
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    console.error(`${SETTINGS} isn't valid JSON. Fix it first; nothing was changed.`);
    process.exit(1);
  }
}

function write(s: Settings) {
  if (fs.existsSync(SETTINGS)) {
    const bak = `${SETTINGS}.bak-claude-shell`;
    if (!fs.existsSync(bak)) fs.copyFileSync(SETTINGS, bak);
  }
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
}

/** Drop our entries (and any entry left empty by that), keep everyone else's. */
function strip(s: Settings): Settings {
  if (!s.hooks) return s;
  for (const ev of Object.keys(s.hooks)) {
    s.hooks[ev] = s.hooks[ev]
      .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !String(h.command ?? '').includes(MARK)) }))
      .filter((e) => e.hooks.length);
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

const installed = (s: Settings) => Object.keys(EVENTS).filter((ev) => s.hooks?.[ev]?.some((e) => e.hooks?.some((h) => String(h.command).includes(MARK))));

const cmd = process.argv[2] ?? 'status';
if (cmd === 'install') {
  if (!fs.existsSync(ENV_FILE)) {
    console.error('relay/.env is missing. Run `npm run setup` first.');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(HOOK), { recursive: true });
  fs.writeFileSync(HOOK, SCRIPT, { mode: 0o700 });
  const s = strip(read());
  s.hooks ??= {};
  for (const [ev, [secs, timeout, matcher]] of Object.entries(EVENTS)) {
    const entry: HookEntry = { hooks: [{ type: 'command', command: `${HOOK} ${secs}`, timeout }] };
    if (matcher) entry.matcher = matcher;
    (s.hooks[ev] ??= []).push(entry);
  }
  write(s);
  console.log(`Installed ClaudeProd hooks for: ${Object.keys(EVENTS).join(', ')}`);
  console.log(`  settings: ${SETTINGS}  (backup: settings.json.bak-claude-shell)`);
  console.log(`  script:   ${HOOK}`);
  console.log('Sessions you start from now on show up live on the lens. Already-open sessions pick');
  console.log('the hooks up when restarted (or after /hooks in that session).');
} else if (cmd === 'remove') {
  write(strip(read()));
  fs.rmSync(HOOK, { force: true });
  console.log('Removed the ClaudeProd hooks. Your other settings are unchanged.');
} else {
  const on = installed(read());
  console.log(on.length ? `Installed for: ${on.join(', ')}` : 'Not installed. Run: npm run hooks -w relay -- install');
}
