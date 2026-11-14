# Integrations

All optional. Each one switches on when its keys are in `relay/.env`. **Settings** on the lens
shows which are live. Restart the relay after editing `.env`.

## Groq: dictation cleanup
1. Create a key at console.groq.com.
2. `GROQ_API_KEY=…` (model: `GROQ_MODEL`, default `llama-3.3-70b-versatile`).

Without a key, the relay does a light local cleanup (removes filler words, fixes capitals). Turn
cleanup off in Settings to send text exactly as dictated.

## Spotify (Premium)
1. developer.spotify.com/dashboard → **Create app**. Under redirect URIs, add
   `https://<your PUBLIC_URL>/spotify/callback` exactly. Tick **Web API**.
2. Put `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and `SPOTIFY_REDIRECT_URI` in `.env`. Restart the relay.
3. On any computer, open `https://<PUBLIC_URL>/spotify/login?k=<SHELL_TOKEN>` and approve.
   The refresh token is saved, so you never log in again.

Playback happens on your phone (or whatever device is active). The lens shows the cover, controls,
a volume ring and covers from your recent listening.

## Google Calendar + Gmail
For the lens, use the Apps Script feed. It runs as you, so there's no OAuth app and no weekly re-login:
follow the header of `integrations/google-apps-script/Code.gs`, then set
`GOOGLE_FEED_URL` and `GOOGLE_FEED_SECRET`.

For Claude sessions (drafting replies, scheduling), connect **Gmail** and **Google Calendar** in your
Claude account's connectors. Claude Code sessions on the relay pick them up.

## Google Maps
1. In Google Cloud console, enable **Routes API** and **Maps Static API**, and create an API key
   (restrict it to those two APIs). A billing account is required, but normal personal use stays in
   the free monthly allowance.
2. `GOOGLE_MAPS_KEY=…`

The lens shows a Monokai-styled map, the walking time and the first steps. Turn-by-turn while
walking is better in Meta's built-in Maps app.

## Comms: Messages, WhatsApp, calls
- **Contacts:** edit `~/.claude-shell/data/contacts.json` (a sample is created on first run):
  ```json
  [{ "id": "mom", "name": "Mom", "initials": "M", "phone": "+15551234567", "whatsapp": true }]
  ```
- **iMessage:** needs [BlueBubbles](https://bluebubbles.app) on a Mac that stays on. Set
  `BLUEBUBBLES_URL` and `BLUEBUBBLES_PASSWORD`. Threads merge into contacts by phone number, and you
  can reply by dictating.
- **WhatsApp and calls:** hand off to the glasses' built-in apps (`wa.me` / `tel:` links). There is no
  safe API for personal WhatsApp, and unofficial bridges risk a permanent ban, so this project doesn't use one.

## Links: browser, YouTube, X, LinkedIn, Discord
Edit `~/.claude-shell/data/lists.json` to change the bookmarks and map favorites:
```json
{ "bookmarks": [{ "name": "YouTube", "url": "https://m.youtube.com" }],
  "favorites": [{ "name": "Home", "address": "123 Main St, City" }] }
```
Pages open in the app's window; back returns to the shell. Sites built for phones may not fit 600×600 well.

## Photos (your library on the lens)
A web app on the glasses can't read the iPhone's photo library or Meta's own Photos app (there's
no API for either). So the relay serves the photos:

- **Relay on your Mac (recommended):** iCloud Photos keeps the Mac's Photos library in sync with your
  iPhone. Install [osxphotos](https://github.com/RhetTbull/osxphotos) (`pipx install osxphotos`) and give
  your terminal (or the app that runs the relay) **Full Disk Access** in System Settings → Privacy & Security.
  `PHOTOS_SOURCE=osxphotos` is the default on macOS. Search uses titles, people, places, Apple's
  scene labels ("dog", "beach"), albums, months and years. Photos stored only in iCloud download on
  first view. Images are resized for the lens with `sips` and cached.
- **Relay on the VM:** `PHOTOS_SOURCE=folder` and `PHOTOS_DIR=/path/to/photos` (JPEG/PNG; e.g. a
  folder you sync from the Mac with rsync or Syncthing).

**Glasses captures:** the Meta AI app imports what you shoot with the glasses into the iPhone's Photos
app (a "Meta AI" album) when auto-import is on. iCloud then brings them to the Mac, and the
**from glasses** chip on the photos screen filters to that album. So the Meta AI app *is* the sync;
nothing else to set up. (Meta's built-in Photos app on the glasses still works alongside, for captures only.)

## 2FA codes
Opt-in, with real trade-offs. See [TWO_FACTOR.md](TWO_FACTOR.md).
