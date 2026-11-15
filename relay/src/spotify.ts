import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';
import { hub, state } from './hub.ts';
import { load, save } from './store.ts';

/**
 * Spotify Web API (Premium needed for playback control).
 * One-time login: open  {PUBLIC_URL}/spotify/login?k={SHELL_TOKEN}  in any browser.
 * The refresh token is saved in DATA_DIR/spotify.json; you won't log in again.
 */
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'playlist-read-private',
].join(' ');

interface Tokens {
  refresh: string;
  access?: string;
  expires?: number;
}
let tokens = load<Tokens | null>('spotify', null);

/**
 * The OAuth `state` is signed rather than kept in memory, so a relay restart between "log in" and
 * Spotify's callback (every .env save restarts it) doesn't break the sign-in. Valid for 15 minutes.
 */
const sign = (v: string) => createHmac('sha256', `spotify-state:${config.token}`).update(v).digest('hex').slice(0, 32);
const newState = () => {
  const v = `${Date.now()}.${randomBytes(6).toString('hex')}`;
  return `${v}.${sign(v)}`;
};
function stateOk(s: string | null) {
  const m = s?.match(/^(\d+\.[0-9a-f]+)\.([0-9a-f]{32})$/);
  if (!m) return false;
  const want = Buffer.from(sign(m[1]));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) && Date.now() - Number(m[1].split('.')[0]) < 15 * 60_000;
}

export const spotifyConfigured = () => Boolean(config.spotifyId && config.spotifySecret && config.spotifyRedirect);

export function spotifyLogin(_req: IncomingMessage, res: ServerResponse) {
  const u = new URL('https://accounts.spotify.com/authorize');
  u.search = new URLSearchParams({
    client_id: config.spotifyId,
    response_type: 'code',
    redirect_uri: config.spotifyRedirect,
    scope: SCOPES,
    state: newState(),
  }).toString();
  res.writeHead(302, { location: u.toString() }).end();
}

export async function spotifyCallback(url: URL, res: ServerResponse) {
  if (url.searchParams.get('error')) {
    res.writeHead(400).end(`Spotify said: ${url.searchParams.get('error')}. Start again from /spotify/login?k=<SHELL_TOKEN>.`);
    return;
  }
  if (!stateOk(url.searchParams.get('state'))) {
    res.writeHead(400).end('This sign-in link expired or is from another setup. Start again from /spotify/login?k=<SHELL_TOKEN>.');
    return;
  }
  const t = await tokenRequest({
    grant_type: 'authorization_code',
    code: url.searchParams.get('code') ?? '',
    redirect_uri: config.spotifyRedirect,
  });
  tokens = { refresh: t.refresh_token, access: t.access_token, expires: Date.now() + t.expires_in * 1000 };
  save('spotify', tokens);
  state.integrations.spotify = true;
  hub.changed();
  res.writeHead(200, { 'content-type': 'text/html' }).end('<h2>Spotify connected.</h2><p>You can close this tab.</p>');
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${config.spotifyId}:${config.spotifySecret}`).toString('base64'),
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`spotify token ${res.status}: ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
}

async function access(): Promise<string | null> {
  if (!tokens) return null;
  if (tokens.access && tokens.expires && tokens.expires > Date.now() + 30_000) return tokens.access;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh });
  tokens = { refresh: t.refresh_token || tokens.refresh, access: t.access_token, expires: Date.now() + t.expires_in * 1000 };
  save('spotify', tokens);
  return tokens.access!;
}

export async function api(method: string, path: string, body?: unknown) {
  const tok = await access();
  if (!tok) return null;
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) throw new Error(`spotify ${method} ${path}: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function pollSpotify() {
  if (!tokens) return;
  state.integrations.spotify = true;
  try {
    const p = await api('GET', '/me/player');
    const item = p?.item;
    const before = JSON.stringify(state.track);
    state.track = item
      ? {
          title: item.name,
          artist: (item.artists ?? []).map((a: any) => a.name).join(', ') || item.show?.name || '',
          album: item.album?.name ?? '',
          art: pickArt(item.album?.images ?? item.images),
          durationMs: item.duration_ms,
          progressMs: p.progress_ms ?? 0,
          playing: Boolean(p.is_playing),
          volume: p.device?.volume_percent ?? null,
          device: p.device?.name ?? null,
        }
      : null;
    if (JSON.stringify(state.track) !== before) hub.changed();
  } catch (e) {
    console.warn('[spotify]', (e as Error).message);
  }
}

export async function loadPicks() {
  if (!tokens) return;
  try {
    const recent = await api('GET', '/me/player/recently-played?limit=30');
    const seen = new Set<string>();
    const picks: typeof state.picks = [];
    for (const r of recent?.items ?? []) {
      const ctx = r.context?.uri ?? r.track?.album?.uri;
      if (!ctx || seen.has(ctx)) continue;
      seen.add(ctx);
      picks.push({ uri: ctx, title: r.track?.album?.name ?? 'Mix', art: pickArt(r.track?.album?.images) });
      if (picks.length >= 8) break;
    }
    state.picks = picks;
    const pl = await api('GET', '/me/playlists?limit=50');
    state.playlists = (pl?.items ?? [])
      .filter((x: any) => x?.uri)
      .map((x: any) => ({ uri: x.uri, title: x.name || 'Playlist', art: pickArt(x.images), count: x.tracks?.total ?? x.items?.total }));
    hub.changed();
  } catch (e) {
    console.warn('[spotify picks]', (e as Error).message);
  }
}

function pickArt(images?: { url: string; width: number }[]): string | null {
  if (!images?.length) return null;
  return [...images].sort((a, b) => Math.abs(a.width - 300) - Math.abs(b.width - 300))[0].url;
}

/**
 * Spotify only takes commands for a device that's active. If none is (nothing played for a while),
 * pick one that's open: the phone, a computer, the glasses' paired phone. null = Spotify isn't open anywhere.
 */
async function deviceParam(): Promise<string> {
  if (state.track?.device) return '';
  const d = await api('GET', '/me/player/devices');
  const list: any[] = (d?.devices ?? []).filter((x: any) => !x.is_restricted);
  const pick = list.find((x) => x.is_active) ?? list.find((x) => x.type === 'Smartphone') ?? list[0];
  if (!pick) throw new Error('Spotify isn\'t open on any device: open it on your phone, then try again');
  return `?device_id=${encodeURIComponent(pick.id)}`;
}

export async function spotifyAction(action: string, value?: number | string) {
  try {
    await doAction(action, value);
  } catch (e) {
    const msg = (e as Error).message;
    hub.broadcast({ t: 'notify', text: msg.includes('open it on your phone') ? msg : `Spotify: ${msg.replace(/^spotify \S+ \S+: /, 'error ')}`, level: 'warn' });
  }
  setTimeout(pollSpotify, 400);
}

async function doAction(action: string, value?: number | string) {
  switch (action) {
    case 'play':
      await api('PUT', `/me/player/play${await deviceParam()}`);
      break;
    case 'pause':
      await api('PUT', '/me/player/pause');
      break;
    case 'next':
      await api('POST', '/me/player/next');
      break;
    case 'prev':
      await api('POST', '/me/player/previous');
      break;
    case 'volume':
      await api('PUT', `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Number(value)))}`);
      break;
    case 'playUri': {
      const uri = String(value);
      await api('PUT', `/me/player/play${await deviceParam()}`, uri.includes(':track:') ? { uris: [uri] } : { context_uri: uri });
      break;
    }
  }
}
