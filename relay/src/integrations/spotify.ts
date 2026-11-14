import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { config } from '../config.ts';
import { hub, state } from '../hub.ts';
import { load, save } from '../store.ts';

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
let oauthState = '';

export const spotifyConfigured = () => Boolean(config.spotifyId && config.spotifySecret && config.spotifyRedirect);

export function spotifyLogin(_req: IncomingMessage, res: ServerResponse) {
  oauthState = randomBytes(12).toString('hex');
  const u = new URL('https://accounts.spotify.com/authorize');
  u.search = new URLSearchParams({
    client_id: config.spotifyId,
    response_type: 'code',
    redirect_uri: config.spotifyRedirect,
    scope: SCOPES,
    state: oauthState,
  }).toString();
  res.writeHead(302, { location: u.toString() }).end();
}

export async function spotifyCallback(url: URL, res: ServerResponse) {
  if (!oauthState || url.searchParams.get('state') !== oauthState) {
    res.writeHead(400).end('State mismatch. Start again from /spotify/login.');
    return;
  }
  oauthState = '';
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

async function api(method: string, path: string, body?: unknown) {
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
    hub.changed();
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
    hub.changed();
  } catch (e) {
    console.warn('[spotify picks]', (e as Error).message);
  }
}

function pickArt(images?: { url: string; width: number }[]): string | null {
  if (!images?.length) return null;
  return [...images].sort((a, b) => Math.abs(a.width - 300) - Math.abs(b.width - 300))[0].url;
}

export async function spotifyAction(action: string, value?: number | string) {
  switch (action) {
    case 'play':
      await api('PUT', '/me/player/play');
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
      await api('PUT', '/me/player/play', uri.includes(':track:') ? { uris: [uri] } : { context_uri: uri });
      break;
    }
  }
  setTimeout(pollSpotify, 400);
}
