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

  claudeAvailable: Boolean(env('CLAUDE_CODE_OAUTH_TOKEN') || env('ANTHROPIC_API_KEY')),
  claudeModel: env('CLAUDE_MODEL') || undefined,
  statusModel: env('STATUS_MODEL', 'haiku'),

  reposDir: expand(env('REPOS_DIR', '~/code')),
  worktreesDir: expand(env('WORKTREES_DIR', '~/.claude-shell/worktrees')),
  dataDir: expand(env('DATA_DIR', '~/.claude-shell/data')),

  groqKey: env('GROQ_API_KEY'),
  groqModel: env('GROQ_MODEL', 'llama-3.3-70b-versatile'),

  spotifyId: env('SPOTIFY_CLIENT_ID'),
  spotifySecret: env('SPOTIFY_CLIENT_SECRET'),
  spotifyRedirect: env('SPOTIFY_REDIRECT_URI'),

  googleFeedUrl: env('GOOGLE_FEED_URL'),
  googleFeedSecret: env('GOOGLE_FEED_SECRET'),
  mapsKey: env('GOOGLE_MAPS_KEY'),

  bbUrl: env('BLUEBUBBLES_URL').replace(/\/$/, ''),
  bbPassword: env('BLUEBUBBLES_PASSWORD'),

  photosSource: (env('PHOTOS_SOURCE') || (process.platform === 'darwin' ? 'osxphotos' : env('PHOTOS_DIR') ? 'folder' : '')) as
    | 'osxphotos'
    | 'folder'
    | '',
  photosDir: env('PHOTOS_DIR') ? expand(env('PHOTOS_DIR')) : '',

  totpPassphrase: env('TOTP_PASSPHRASE'),
  totpUnlock: env('TOTP_UNLOCK').toLowerCase().split(/[\s,]+/).filter(Boolean),

  /** Built glasses app, served at / so one HTTPS URL covers everything. */
  glassesDist: path.resolve(here, '../../glasses/dist'),
};

for (const dir of [config.worktreesDir, config.dataDir]) fs.mkdirSync(dir, { recursive: true });

if (!config.token || config.token === 'change-me') {
  console.error('\n[relay] SHELL_TOKEN is not set. Run `npm run setup` in relay/ first.\n');
  process.exit(1);
}
