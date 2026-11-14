import '../src/config.ts';
import readline from 'node:readline/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { createRequire } from 'node:module';
// jsqr ships CommonJS; require it so the default export is callable under ESM.
const jsQR = createRequire(import.meta.url)('jsqr') as typeof import('jsqr').default;
import { loadVault, parseImport, saveVault, codes } from '../src/totp.ts';

/**
 * Import 2FA accounts into the relay's encrypted vault.
 *
 *   npm run 2fa:import                         paste links when asked (they aren't saved in shell history)
 *   npm run 2fa:import -- --list               show what's imported (issuer + account only)
 *   npm run 2fa:import -- --remove <issuer>    remove accounts by issuer
 *   npm run 2fa:import -- --image <file>       read the export QR from a screenshot or photo (PNG/JPEG/HEIC)
 *
 * Get the links: Google Authenticator → ⋮ → Transfer accounts → Export accounts → pick accounts →
 * it shows a QR. Scan it with any QR reader (e.g. iPhone Camera → long-press "copy link"),
 * which gives an otpauth-migration://offline?data=… link. Paste that here.
 */
const args = process.argv.slice(2);
let vault = loadVault();

if (args[0] === '--list') {
  for (const c of codes(vault)) console.log(`${c.issuer.padEnd(24)} ${c.account}`);
  console.log(`${vault.length} account(s).`);
  process.exit(0);
}
if (args[0] === '--remove') {
  const issuer = (args[1] ?? '').toLowerCase();
  const before = vault.length;
  vault = vault.filter((a) => a.issuer.toLowerCase() !== issuer);
  saveVault(vault);
  console.log(`Removed ${before - vault.length}.`);
  process.exit(0);
}

/** Decode the QR in an image. macOS `sips` converts any format to PNG; the link stays in memory. */
function qrFromImage(file: string): string {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), '2fa-')), 'qr.png');
  try {
    execFileSync('sips', ['-s', 'format', 'png', file, '--out', tmp], { stdio: 'ignore' });
    const png = PNG.sync.read(fs.readFileSync(tmp));
    const hit = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: 'attemptBoth' });
    if (hit?.data) return hit.data;
    // Dense codes (Authenticator exports): fall back to macOS Vision.
    if (process.platform === 'darwin') {
      const swift = path.join(path.dirname(new URL(import.meta.url).pathname), 'qr-decode.swift');
      try {
        const out = execFileSync('swift', [swift, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (out) return out;
      } catch {}
    }
    throw new Error('no QR code found in that image (crop closer to the QR and try again)');
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

function add(accounts: ReturnType<typeof parseImport>) {
  for (const a of accounts) {
    vault = vault.filter((x) => !(x.issuer === a.issuer && x.account === a.account));
    vault.push(a);
    console.log(`  + ${a.issuer} · ${a.account}`);
  }
  return accounts.length;
}

if (args[0] === '--image') {
  const file = args[1] ?? '';
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }
  const n = add(parseImport(qrFromImage(file)));
  saveVault(vault);
  console.log(`\nSaved ${n} account(s), ${vault.length} total, encrypted with TOTP_PASSPHRASE.`);
  console.log('Now delete the screenshot (and from Recently Deleted): it holds the secrets in plain form.');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('Paste one link per line (otpauth-migration://… or otpauth://totp/…). Empty line to finish.');
let added = 0;
while (true) {
  const line = (await rl.question('> ')).trim();
  if (!line) break;
  try {
    added += add(parseImport(line));
  } catch (e) {
    console.log(`  ! ${(e as Error).message}`);
  }
}
rl.close();
saveVault(vault);
console.log(`\nSaved ${added} account(s), ${vault.length} total, encrypted with TOTP_PASSPHRASE.`);
console.log('Delete any screenshots or copies of the export QR/link now.');
