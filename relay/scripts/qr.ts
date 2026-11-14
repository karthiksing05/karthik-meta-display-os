import 'dotenv/config';
import QRCode from 'qrcode';
import path from 'node:path';
import { appUrl, installLink } from './links.ts';

// Usage: npm run qr                 (uses PUBLIC_URL from .env)
//        npm run qr -- https://abc.trycloudflare.com
const publicUrl = (process.argv[2] ?? process.env.PUBLIC_URL ?? '').trim();
const token = (process.env.SHELL_TOKEN ?? '').trim();

if (!publicUrl.startsWith('https://')) {
  console.error('Need an https:// URL. Pass one (`npm run qr -- https://…`) or set PUBLIC_URL in relay/.env.');
  process.exit(1);
}
if (!token || token === 'change-me') {
  console.error('SHELL_TOKEN is missing. Run `npm run setup` first.');
  process.exit(1);
}

const link = installLink(publicUrl, token);
const out = path.resolve('install-qr.png');
await QRCode.toFile(out, link, { margin: 2, width: 480 });
console.log('\nScan this with your phone camera (Meta AI app must be installed, Developer Mode on):\n');
console.log(await QRCode.toString(link, { type: 'terminal', small: true }));
console.log(`Also saved: ${out}`);
console.log(`\nApp URL (for the simulator):\n  ${appUrl(publicUrl, token)}`);
console.log(`\nDeeplink:\n  ${link}\n`);
console.log('Keep the QR private: it contains your relay token.\n');
