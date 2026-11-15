import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function expand(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

const env = (k: string, d = ''): string => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env('PORT', '8787')),
  token: env('SHELL_TOKEN'),
  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''),
  demo: env('DEMO') === '1',

  /**
   * login = sessions use your Claude Code login on this machine (`claude` → /login), which also loads
   *         your claude.ai connectors (Gmail, Calendar, Drive, Slack…). Default.
   * token = use CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY (for a server with no login; no connectors).
   */
  claudeAuth: (env('CLAUDE_AUTH', 'login') === 'token' ? 'token' : 'login') as 'login' | 'token',
  claudeAvailable: env('CLAUDE_AUTH', 'login') !== 'token' || Boolean(env('CLAUDE_CODE_OAUTH_TOKEN') || env('ANTHROPIC_API_KEY')),
  claudeModel: env('CLAUDE_MODEL') || undefined,
  statusModel: env('STATUS_MODEL', 'haiku'),

  reposDir: expand(env('REPOS_DIR', '~/code')),
  worktreesDir: expand(env('WORKTREES_DIR', '~/.claude-shell/worktrees')),
  dataDir: expand(env('DATA_DIR', '~/.claude-shell/data')),
  /** Working folders for one-off chats (no repo). */
  chatsDir: expand(env('CHATS_DIR', '~/.claude-shell/chats')),

  groqKey: env('GROQ_API_KEY'),
  // App lock (see src/lock.ts): a swipe pattern and/or a password for the whole app.
  appPattern: env('APP_PATTERN').toLowerCase().split(/[\s,]+/).filter(Boolean),
  appPassword: env('APP_PASSWORD'),
  appLockHours: Number(env('APP_LOCK_HOURS', '12')) || 12,
  totpPassphrase: env('TOTP_PASSPHRASE'),
  totpUnlock: env('TOTP_UNLOCK').toLowerCase().split(/[\s,]+/).filter(Boolean),
  groqModel: env('GROQ_MODEL', 'openai/gpt-oss-20b'),
  spotifyId: env('SPOTIFY_CLIENT_ID'),
  spotifySecret: env('SPOTIFY_CLIENT_SECRET'),
  /** Defaults to {PUBLIC_URL}/spotify/callback; it must be listed in your Spotify app's settings. */
  spotifyRedirect: env('SPOTIFY_REDIRECT_URI') || (env('PUBLIC_URL') ? `${env('PUBLIC_URL').replace(/\/$/, '')}/spotify/callback` : ''),

  /** Built glasses app, served at / so one HTTPS URL covers everything. */
  glassesDist: path.resolve(here, '../../glasses/dist'),
};

for (const dir of [config.worktreesDir, config.dataDir, config.chatsDir]) fs.mkdirSync(dir, { recursive: true });

if (!config.token || config.token === 'change-me') {
  console.error('\n[relay] SHELL_TOKEN is not set. Run `npm run setup` in relay/ first.\n');
  process.exit(1);
}

/** Environment for Claude processes the relay starts. In login mode the token is dropped so the CLI uses your login (and connectors). */
export function claudeEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = { ...process.env, ...extra };
  if (config.claudeAuth === 'login') {
    delete e.CLAUDE_CODE_OAUTH_TOKEN;
    delete e.ANTHROPIC_API_KEY;
  }
  return e;
}
