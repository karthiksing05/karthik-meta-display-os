import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';

/**
 * App lock: the whole app (every session, approval and message) stays locked until you unlock it.
 *
 * Why: the install link carries SHELL_TOKEN, so anyone who gets that link (a screenshot of the QR,
 * browser history) could otherwise drive your Claude sessions. With a lock they also need something
 * only you know.
 *
 *   APP_PATTERN=up up left right down down   swipe pattern (what you use on the glasses)
 *   APP_PASSWORD=…                            or a password (typed or dictated; handy in a browser)
 *   APP_LOCK_HOURS=12                         how long an unlock lasts on that device
 *
 * An unlock gives the device a signed pass (kept in its storage) so it isn't asked again until it
 * expires. Changing the pattern/password or SHELL_TOKEN invalidates every pass.
 * 5 wrong tries → locked for 15 minutes, for everyone.
 */
export const lockEnabled = () => Boolean(config.appPattern.length || config.appPassword);
export const lockMethod = (): 'pattern' | 'password' => (config.appPattern.length ? 'pattern' : 'password');

const secret = () => `${config.token}\n${config.appPattern.join(' ')}\n${config.appPassword}`;
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

/** A pass for this device, valid for APP_LOCK_HOURS. */
export function issuePass(): { pass: string; until: number } {
  const until = Date.now() + config.appLockHours * 3600_000;
  const body = Buffer.from(JSON.stringify({ until })).toString('base64url');
  return { pass: `${body}.${sign(body)}`, until };
}

export function passOk(pass: string | null | undefined): boolean {
  if (!lockEnabled()) return true;
  if (!pass) return false;
  const [body, mac] = pass.split('.');
  if (!body || !mac) return false;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  try {
    return Date.now() < JSON.parse(Buffer.from(body, 'base64url').toString('utf8')).until;
  } catch {
    return false;
  }
}

let fails = 0;
let lockedUntil = 0;

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function tryAppUnlock(input: { pattern?: string[]; password?: string }): { ok: true } | { ok: false; reason: string; triesLeft?: number } {
  if (Date.now() < lockedUntil) return { ok: false, reason: `too many tries · wait ${Math.ceil((lockedUntil - Date.now()) / 60000)} min` };
  const okPattern = config.appPattern.length > 0 && same((input.pattern ?? []).map((s) => s.toLowerCase()).join(' '), config.appPattern.join(' '));
  const okPassword = Boolean(config.appPassword) && same((input.password ?? '').trim(), config.appPassword);
  if (okPattern || okPassword) {
    fails = 0;
    return { ok: true };
  }
  fails++;
  if (fails >= 5) {
    fails = 0;
    lockedUntil = Date.now() + 15 * 60_000;
    console.warn('[lock] 5 wrong unlock attempts: locked for 15 minutes');
    return { ok: false, reason: 'locked for 15 min' };
  }
  return { ok: false, reason: input.password != null ? 'wrong password' : 'wrong pattern', triesLeft: 5 - fails };
}
