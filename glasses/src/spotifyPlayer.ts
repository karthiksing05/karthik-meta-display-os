import { onMessage, send, store } from './store.ts';

/**
 * The glasses as a Spotify player (Spotify's Web Playback SDK): music plays from the glasses' own
 * speakers, no phone app needed. Needs Spotify Premium and a sign-in with the `streaming` permission
 * (state.integrations.spotifyPlayer). Started the first time you open the music screen; it then keeps
 * playing while you use the rest of the app, and goes away when the app closes.
 *
 * If the glasses' browser can't play protected audio, `lens.error` says so and the music screen
 * falls back to controlling Spotify on your phone.
 */
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: any;
  }
}

export const lens = { started: false, ready: false, error: '' };
let player: any = null;

function token(): Promise<string | null> {
  const reqId = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timer = setTimeout(() => (off(), resolve(null)), 8000);
    const off = onMessage((m) => {
      if (m.t === 'spotify.token' && m.reqId === reqId) {
        clearTimeout(timer);
        off();
        resolve(m.token);
      }
    });
    send({ t: 'spotify.token', reqId });
  });
}

export function startLensPlayer() {
  if (lens.started || !store.state?.integrations.spotifyPlayer) return;
  lens.started = true;
  const fail = (why: string) => {
    lens.ready = false;
    lens.error = why;
    store.emit();
  };
  window.onSpotifyWebPlaybackSDKReady = () => {
    player = new window.Spotify.Player({
      name: 'ClaudeProd glasses',
      volume: 0.8,
      getOAuthToken: (cb: (t: string) => void) => token().then((t) => (t ? cb(t) : fail('no Spotify token from the relay'))),
    });
    player.addListener('ready', ({ device_id }: { device_id: string }) => {
      lens.ready = true;
      lens.error = '';
      send({ t: 'spotify.device', id: device_id });
      store.emit();
    });
    player.addListener('not_ready', () => {
      lens.ready = false;
      send({ t: 'spotify.device', id: null });
      store.emit();
    });
    player.addListener('initialization_error', () => fail("these glasses can't play Spotify audio in an app"));
    player.addListener('authentication_error', () => fail('sign in to Spotify again'));
    player.addListener('account_error', () => fail('Spotify Premium is needed to play here'));
    player.addListener('playback_error', ({ message }: { message: string }) => fail(message));
    player.connect();
  };
  const s = document.createElement('script');
  s.src = 'https://sdk.scdn.co/spotify-player.js';
  s.onerror = () => fail("couldn't load Spotify's player");
  document.head.append(s);
}

/** Browsers only let audio start from a user action: call this inside a pinch handler. */
export function unlockAudio() {
  player?.activateElement?.();
}
