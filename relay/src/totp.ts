import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TotpCode } from '../../shared/protocol.ts';
import { config } from './config.ts';

/**
 * 2FA codes on the lens. OPT-IN: read docs/TWO_FACTOR.md first.
 *
 * Google Authenticator has no API. You export accounts from it ("Transfer accounts" QR),
 * import them with `npm run 2fa:import`, and the relay computes the same TOTP codes.
 *
 * Safeguards:
 *  - secrets are encrypted at rest (AES-256-GCM, key from TOTP_PASSPHRASE via scrypt)
 *  - codes are never in the shared state; they go only to the one connection that unlocked
 *  - unlocking needs the swipe pattern TOTP_UNLOCK; it lasts 60 s
 *  - 5 wrong patterns → locked for 15 minutes
 */

export interface TotpAccount {
  id: string;
  issuer: string;
  account: string;
  secret: string; // base32
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: 6 | 8;
  period: number;
}

const FILE = path.join(config.dataDir, 'totp.enc');

function key(salt: Buffer) {
  if (!config.totpPassphrase) throw new Error('TOTP_PASSPHRASE is not set');
  return scryptSync(config.totpPassphrase, salt, 32);
}

export function loadVault(): TotpAccount[] {
  if (!fs.existsSync(FILE)) return [];
  const buf = fs.readFileSync(FILE);
  const salt = buf.subarray(0, 16), iv = buf.subarray(16, 28), tag = buf.subarray(28, 44), data = buf.subarray(44);
  const d = createDecipheriv('aes-256-gcm', key(salt), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}

export function saveVault(accounts: TotpAccount[]) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(salt), iv);
  const data = Buffer.concat([c.update(JSON.stringify(accounts), 'utf8'), c.final()]);
  fs.writeFileSync(FILE, Buffer.concat([salt, iv, c.getAuthTag(), data]), { mode: 0o600 });
}

export const totpEnabled = () => Boolean(config.totpPassphrase && config.totpUnlock.length >= 4 && fs.existsSync(FILE));

// ---------- RFC 6238 ----------
export function base32(s: string): Buffer {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function toBase32(b: Buffer): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = '';
  for (const byte of b) {
    val = (val << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += A[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += A[(val << (5 - bits)) & 31];
  return out;
}

export function totp(a: TotpAccount, t = Date.now()): string {
  const counter = Math.floor(t / 1000 / a.period);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(a.algorithm.toLowerCase(), base32(a.secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** a.digits).padStart(a.digits, '0');
}

export function codes(accounts: TotpAccount[]): TotpCode[] {
  const now = Date.now();
  return accounts.map((a) => ({
    id: a.id,
    issuer: a.issuer,
    account: a.account,
    code: totp(a, now),
    period: a.period,
    remaining: a.period - (Math.floor(now / 1000) % a.period),
  }));
}

// ---------- unlock with a swipe pattern ----------
let fails = 0;
let lockedUntil = 0;

export function tryUnlock(seq: string[]): { ok: true } | { ok: false; reason: string; triesLeft?: number } {
  if (Date.now() < lockedUntil) return { ok: false, reason: `too many tries · wait ${Math.ceil((lockedUntil - Date.now()) / 60000)} min` };
  const want = Buffer.from(config.totpUnlock.join(' '));
  const got = Buffer.from(seq.map((s) => s.toLowerCase()).join(' '));
  if (want.length === got.length && timingSafeEqual(want, got)) {
    fails = 0;
    return { ok: true };
  }
  fails++;
  if (fails >= 5) {
    lockedUntil = Date.now() + 15 * 60_000;
    fails = 0;
    console.warn('[2fa] 5 wrong unlock patterns: locked for 15 minutes');
    return { ok: false, reason: 'locked for 15 min' };
  }
  return { ok: false, reason: 'wrong pattern', triesLeft: 5 - fails };
}

// ---------- import (otpauth:// and Google Authenticator export) ----------
/** Minimal protobuf reader for otpauth-migration://offline?data=… */
function readProto(buf: Buffer) {
  const fields: { no: number; wire: number; val: Buffer | number }[] = [];
  let i = 0;
  const varint = () => {
    let r = 0, shift = 0, b: number;
    do {
      b = buf[i++];
      r += (b & 127) * 2 ** shift;
      shift += 7;
    } while (b & 128);
    return r;
  };
  while (i < buf.length) {
    const tag = varint();
    const no = tag >>> 3, wire = tag & 7;
    if (wire === 0) fields.push({ no, wire, val: varint() });
    else if (wire === 2) {
      const len = varint();
      fields.push({ no, wire, val: buf.subarray(i, i + len) });
      i += len;
    } else throw new Error(`unsupported protobuf wire type ${wire}`);
  }
  return fields;
}

export function parseImport(uri: string): TotpAccount[] {
  const u = new URL(uri.trim());
  if (u.protocol === 'otpauth-migration:') {
    const data = Buffer.from(decodeURIComponent(u.searchParams.get('data') ?? ''), 'base64');
    return readProto(data)
      .filter((f) => f.no === 1 && Buffer.isBuffer(f.val))
      .map((f) => {
        const p = readProto(f.val as Buffer);
        const get = (n: number) => p.find((x) => x.no === n)?.val;
        const type = (get(6) as number) ?? 2;
        if (type === 1) throw new Error(`"${(get(2) as Buffer)?.toString()}" is HOTP (counter-based); only TOTP is supported`);
        const algo = ({ 2: 'SHA256', 3: 'SHA512' } as Record<number, TotpAccount['algorithm']>)[(get(4) as number) ?? 1] ?? 'SHA1';
        const name = (get(2) as Buffer | undefined)?.toString('utf8') ?? '';
        const issuer = (get(3) as Buffer | undefined)?.toString('utf8') || name.split(':')[0];
        return mk(issuer, name.includes(':') ? name.split(':').slice(1).join(':') : name, toBase32(get(1) as Buffer), algo, get(5) === 2 ? 8 : 6, 30);
      });
  }
  if (u.protocol === 'otpauth:' && u.host === 'totp') {
    const label = decodeURIComponent(u.pathname.slice(1));
    const issuer = u.searchParams.get('issuer') ?? label.split(':')[0];
    const algo = (u.searchParams.get('algorithm') ?? 'SHA1').toUpperCase() as TotpAccount['algorithm'];
    return [mk(issuer, label.split(':').pop() ?? label, u.searchParams.get('secret') ?? '', algo, Number(u.searchParams.get('digits') ?? 6) as 6 | 8, Number(u.searchParams.get('period') ?? 30))];
  }
  throw new Error('Expected an otpauth-migration:// or otpauth://totp/ link');
}

function mk(issuer: string, account: string, secret: string, algorithm: TotpAccount['algorithm'], digits: 6 | 8, period: number): TotpAccount {
  return { id: randomBytes(6).toString('hex'), issuer, account, secret, algorithm, digits, period };
}
