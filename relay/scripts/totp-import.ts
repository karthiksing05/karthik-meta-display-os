import '../src/config.ts';
import readline from 'node:readline/promises';
import { loadVault, parseImport, saveVault, codes } from '../src/totp.ts';

/**
 * Import 2FA accounts into the relay's encrypted vault.
 *
 *   npm run 2fa:import                         paste links when asked (they aren't saved in shell history)
 *   npm run 2fa:import -- --list               show what's imported (issuer + account only)
 *   npm run 2fa:import -- --remove <issuer>    remove accounts by issuer
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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('Paste one link per line (otpauth-migration://… or otpauth://totp/…). Empty line to finish.');
let added = 0;
while (true) {
  const line = (await rl.question('> ')).trim();
  if (!line) break;
  try {
    const accounts = parseImport(line);
    for (const a of accounts) {
      vault = vault.filter((x) => !(x.issuer === a.issuer && x.account === a.account));
      vault.push(a);
      console.log(`  + ${a.issuer} · ${a.account}`);
      added++;
    }
  } catch (e) {
    console.log(`  ! ${(e as Error).message}`);
  }
}
rl.close();
saveVault(vault);
console.log(`\nSaved ${added} account(s), ${vault.length} total, encrypted with TOTP_PASSPHRASE. Restart the relay.`);
console.log('Delete any screenshots or copies of the export QR/link now.');
