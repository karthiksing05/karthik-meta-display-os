# Push Claude Shell to your glasses

Meta Ray-Ban Display runs **web apps from an HTTPS URL**. There's nothing to sideload and no
7-day expiry: you install a link once, and every time you redeploy the relay, the glasses get
the new version the next time the app opens.

The relay serves the glasses app itself, so **one HTTPS address covers everything**
(app, WebSocket, Spotify login, map images).

```
glasses ──(phone's internet)──▶ https://your-relay/  ──▶ relay (Mac or Oracle VM)
```

---

## 0. One-time checks

| What | Where to look | Need |
|---|---|---|
| Meta AI app version | Meta AI app → **Settings → App Info → App version** | v272 or later |
| Glasses version | **Devices → your glasses → gear icon → General → About → Release Version** | v125 or later |

Update either one from the App Store / the Meta AI app if it's older.

## 1. Turn on Developer Mode (once)

1. Open the **Meta AI** app on your iPhone.
2. Go to **Settings → App Info**.
3. Tap the **App version** number **five times**. A pop-up appears.
4. Tap **Enable**.

It stays on; you never do this again.

## 2. Try it in demo mode first (2 minutes, no keys)

On your Mac, in this folder:

```bash
npm run setup          # installs everything, writes relay/.env with a random SHELL_TOKEN
npm run demo           # builds the glasses app and starts the relay with fake data on :8787
```

In a second terminal, give it a temporary public HTTPS address:

```bash
brew install cloudflared              # once
cloudflared tunnel --url http://localhost:8787
```

It prints a URL like `https://random-words.trycloudflare.com`. Then:

```bash
npm run qr -- https://random-words.trycloudflare.com
```

This prints a QR code in the terminal and saves `relay/install-qr.png`.

## 3. Install on the glasses

1. Point your **iPhone camera** at the QR code and tap the link.
   (It's a `fb-viewapp://web_app_deep_link?...` link; a plain QR of the website is **not** recognized.)
2. The Meta AI app opens a confirmation screen showing **Claude Shell**.
   It's marked **unverified** because it isn't reviewed by Meta. That's expected for your own apps.
3. Confirm. Claude Shell is added to your glasses' apps. Open it from there.

On first launch the app reads the token from the install link, saves it, and removes it from
the address. You should see the home screen with a `demo` tag and a green dot (relay connected).

> **Keep the QR private.** It contains your `SHELL_TOKEN`. If it leaks, change the token in
> `relay/.env`, restart the relay and reinstall.

**Already on the phone?** Open `https://<your-url>/install?k=<SHELL_TOKEN>` in the phone's browser
and tap **"Tap here instead"**.

## 4. Use a stable address (do this before real use)

`trycloudflare.com` URLs change every time `cloudflared` restarts, which means reinstalling.
Pick one permanent option:

**A. Tailscale Funnel: free, no domain needed (recommended)**

```bash
brew install tailscale            # Mac; on the Oracle VM deploy/oracle-setup.sh installs it
sudo tailscale up                 # log in once
sudo tailscale funnel --bg 8787   # → https://<machine>.<tailnet>.ts.net
```

**B. Cloudflare named tunnel: needs a domain on Cloudflare.** See `deploy/cloudflared-config.yml`.

Put the address in `relay/.env` as `PUBLIC_URL=https://…`, restart the relay, run `npm run qr` (no
argument needed now), and install once more. You won't need to reinstall again.

> The glasses can't run Tailscale themselves. Funnel publishes the relay to the normal internet over
> HTTPS, which is exactly what the glasses need. The `SHELL_TOKEN` is what keeps it private.

## 5. Updating the app

| Changed | Do this | Reinstall? |
|---|---|---|
| Glasses UI (`glasses/`) | `npm run build`, then restart the relay | No. Close and reopen the app on the glasses |
| Relay (`relay/`) | restart the relay (`npm start`, or `sudo systemctl restart claude-shell` on the VM) | No |
| Public URL or token | `npm run qr`, scan again | Yes |

On the VM: `cd ~/claude-shell && git pull && npm run build && sudo systemctl restart claude-shell`.

## 6. Develop without the glasses

- **Simulator:** install the **Meta Ray-Ban Display Simulator** Chrome extension. It recreates the
  600×600 additive display and D-pad input. Its **View on Glasses QR** feature can also make the
  install QR for whatever URL you're previewing.
- **Hot reload:** `npm run dev:demo` → open `http://localhost:5173/?k=<SHELL_TOKEN>` in Chrome.
  Arrow keys = swipes, Enter = pinch, Escape = back.
- **Docs inside Claude Code:** `claude mcp add --transport http meta-wearables https://mcp.developer.meta.com/wearables`

## Input mapping (what the app expects)

| Gesture (Neural Band) | Key the app gets | In Claude Shell |
|---|---|---|
| Thumb swipe up/down/left/right | ArrowUp/Down/Left/Right | move focus. On the approval card: → approve, ← deny, ↓ always |
| Index pinch | Enter | select |
| Middle-finger tap | back (Escape / browser history) | back |
| Pinch + twist | system volume | volume (Spotify audio plays through the glasses) |
| Text fields | system composer | dictate, handwrite or type, then cleaned by Groq |

## Troubleshooting

| Symptom | Fix |
|---|---|
| QR opens a web page instead of the Meta AI app | Use the QR from `npm run qr` or `/install`, not a QR of the plain URL |
| Install fails or "can't open" | URL must be HTTPS with a valid certificate. Plain `http://` and LAN IPs are rejected |
| "No relay token" screen | You opened the app without `?k=`. Reinstall from the QR |
| Red dot in the header (relay offline) | Relay not running, or the tunnel is down. Check `curl https://<url>/healthz` |
| Spotify says "not connected" | Do the one-time login in `docs/INTEGRATIONS.md` |
| Band battery shows "—" | Expected. Meta doesn't expose the Neural Band's battery to web apps (yet). Glasses battery uses `navigator.getBattery()` |

Still to test on real hardware (phase 0): whether `tel:` and `wa.me` links hand off to the
built-in call/WhatsApp apps, whether a held pinch reaches web apps, and how the system composer's
dictation performs for code. See `docs/ARCHITECTURE.md → Phase 0 checklist`.
