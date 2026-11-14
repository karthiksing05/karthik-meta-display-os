import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Creates relay/.env from .env.example with a fresh SHELL_TOKEN. Safe to re-run:
// it never overwrites an existing .env, it only fills a missing/placeholder token.
const envPath = path.resolve('.env');
const example = fs.readFileSync(path.resolve('.env.example'), 'utf8');
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : example;

const token = randomBytes(24).toString('base64url');
if (/^SHELL_TOKEN=(change-me)?\s*$/m.test(env)) {
  env = env.replace(/^SHELL_TOKEN=.*$/m, `SHELL_TOKEN=${token}`);
  console.log('Generated a new SHELL_TOKEN.');
} else {
  console.log('SHELL_TOKEN already set; leaving it.');
}
fs.writeFileSync(envPath, env, { mode: 0o600 });
console.log(`Wrote ${envPath}. Fill in the keys you have; everything else is optional.`);
