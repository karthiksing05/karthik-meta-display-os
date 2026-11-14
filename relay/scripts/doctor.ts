import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../src/config.ts';
import { scanRepos } from '../src/sessions.ts';

/**
 * npm run doctor — checks the relay, public URL, Claude login, repos, session hooks and Groq,
 * and prints exactly what to do for anything that isn't working. Never prints secrets.
 */
type Result = { ok: boolean | null; name: string; detail: string; fix?: string[] };
const results: Result[] = [];
const add = (r: Result) => results.push(r);
const has = (bin: string) => {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const timeout = (ms = 10_000) => AbortSignal.timeout(ms);
const url = config.publicUrl && !config.publicUrl.includes('shell.example.com') ? config.publicUrl : '';
const ENV = 'relay/.env';

async function core() {
  // Relay + public URL
  let local = false;
  try {
    local = (await fetch(`http://127.0.0.1:${config.port}/healthz`, { signal: timeout(2000) })).ok;
  } catch {}
  add({ ok: local, name: 'relay', detail: local ? `running on :${config.port}` : 'not running', fix: local ? undefined : ['npm run up'] });

  if (!url) add({ ok: false, name: 'public url', detail: 'PUBLIC_URL not set', fix: ['npm run up (sets it for you)'] });
  else {
    let pub = false;
    try {
      pub = (await fetch(`${url}/healthz`, { signal: timeout(8000) })).ok;
    } catch {}
    const quick = url.includes('trycloudflare.com');
    add({
      ok: pub,
      name: 'public url',
      detail: `${url}${pub ? '' : ' (not answering)'}${quick ? ' · changes every run' : ''}`,
      fix: [
        ...(pub ? [] : ['start it with npm run up']),
        ...(quick ? ['for a URL that never changes: brew install --cask tailscale, sign in, re-run npm run up, scan once more'] : []),
      ],
    });
  }

  // Claude
  if (config.claudeAuth === 'login') {
    add({
      ok: has('claude'),
      name: 'claude',
      detail: has('claude') ? 'uses your Claude Code login on this Mac (connectors included)' : 'claude CLI not found',
      fix: [
        ...(has('claude') ? [] : ['install Claude Code, then run `claude` and /login']),
        'if sessions fail with an auth error: run `claude`, then /login',
        'Gmail / Calendar connectors say needs-auth: connect them at claude.ai → Settings → Connectors',
      ],
    });
  } else {
    const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    const api = process.env.ANTHROPIC_API_KEY?.trim();
    add({
      ok: Boolean(oauth || api),
      name: 'claude',
      detail: oauth ? 'token mode (no connectors)' : api ? 'API key (no connectors)' : 'CLAUDE_AUTH=token but no token set',
      fix: oauth || api ? undefined : ['claude setup-token → CLAUDE_CODE_OAUTH_TOKEN in ' + ENV + ', or set CLAUDE_AUTH=login'],
    });
  }

  // Repos
  const repos = scanRepos().length;
  add({
    ok: repos > 0,
    name: 'repos',
    detail: `${config.reposDir.replace(os.homedir(), '~')} · ${repos} git repo(s) found (up to 3 levels deep)`,
    fix: repos ? undefined : ['set REPOS_DIR in ' + ENV + ' to the folder whose subfolders are your git repos'],
  });

  // Hooks (outside sessions: terminal, VS Code, Remote Control)
  let hooks = false;
  try {
    hooks = fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8').includes('.claude-shell/hook.sh');
  } catch {}
  add({
    ok: hooks,
    name: 'all sessions',
    detail: hooks ? 'hooks installed: terminal / VS Code / Remote Control sessions show live' : 'only recent sessions (no live status or approvals)',
    fix: hooks ? undefined : ['npm run hooks -- install'],
  });
}

async function groq() {
  if (!config.groqKey) return add({ ok: null, name: 'groq', detail: 'off · dictation uses light local cleanup', fix: ['console.groq.com → API Keys → create → GROQ_API_KEY in ' + ENV] });
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${config.groqKey}` }, signal: timeout() });
    add({ ok: r.ok, name: 'groq', detail: r.ok ? 'key works' : `key rejected (${r.status})`, fix: r.ok ? undefined : ['check GROQ_API_KEY'] });
  } catch (e) {
    add({ ok: false, name: 'groq', detail: (e as Error).message });
  }
}

function lock() {
  const on = config.appPattern.length > 0 || Boolean(config.appPassword);
  add({
    ok: on ? true : null,
    name: 'app lock',
    detail: on ? `on (${config.appPattern.length ? 'swipe pattern' : 'password'}, ${config.appLockHours} h per unlock)` : 'off · anyone with your install link could drive your sessions',
    fix: on ? undefined : ['set APP_PATTERN (6+ moves, e.g. up up left right down left) or APP_PASSWORD in ' + ENV],
  });
}

function twofa() {
  const pass = Boolean(config.totpPassphrase), pat = config.totpUnlock.length >= 4;
  const vault = fs.existsSync(path.join(config.dataDir, 'totp.enc'));
  if (pass && pat && vault) return add({ ok: true, name: '2fa', detail: 'vault imported · home → 2fa, swipe your pattern' });
  add({
    ok: null,
    name: '2fa',
    detail: 'off (opt-in)',
    fix: [
      ...(pass ? [] : ['set TOTP_PASSPHRASE (long random) in ' + ENV]),
      ...(pat ? [] : ['set TOTP_UNLOCK (6+ moves, e.g. up up left right down left) in ' + ENV]),
      ...(vault ? [] : ['npm run 2fa  (paste Authenticator export links; read docs/TWO_FACTOR.md first)']),
    ],
  });
}

await core();
await groq();
lock();
twofa();

const C = { g: '\x1b[38;2;166;226;46m', p: '\x1b[38;2;255;97;136m', m: '\x1b[38;2;163;158;135m', y: '\x1b[38;2;230;219;116m', x: '\x1b[0m' };
console.log('');
for (const r of results) {
  const mark = r.ok === true ? `${C.g}✓${C.x}` : r.ok === false ? `${C.p}✗${C.x}` : `${C.m}–${C.x}`;
  console.log(`${mark} ${C.y}${r.name.padEnd(18)}${C.x}${r.detail}`);
  for (const f of r.fix ?? []) console.log(`  ${C.m}→${C.x} ${f}`);
}
const todo = results.filter((r) => r.ok !== true).length;
console.log(`\n${todo ? `${todo} to set up. ✗ = broken, – = optional/off.` : 'Everything is set up.'} The relay restarts by itself when you save ${ENV}.\n`);
