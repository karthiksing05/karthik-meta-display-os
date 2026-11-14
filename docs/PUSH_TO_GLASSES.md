# Putting ClaudeProd on your glasses

Meta Ray-Ban Display runs **web apps from an HTTPS address**. There's nothing to sideload and no
expiry: you install a link once, and the glasses load the latest version from the relay every
time the app opens.

The relay serves the glasses app itself, so **one HTTPS address covers everything** (app and
WebSocket):

```
glasses ──(phone's internet)──▶ https://your-mac.your-tailnet.ts.net ──▶ relay on your Mac
```

---

## 0. One-time checks

| What | Where to look | Need |
|---|---|---|
| Meta AI app version | Meta AI app → **Settings → App Info → App version** | v272 or later |
| Glasses version | **Devices → your glasses → gear icon → General → About → Release Version** | v125 or later |
| Developer Mode | Meta AI app → **Settings → App Info** → tap **App version** 5 times → **Enable** | on (stays on) |

## 1. Start the relay

Either:

- **The menu bar app (easiest):** `npm run app`. It starts everything and keeps it running.
- **A terminal:** `npm run up`. Same steps; Ctrl-C stops everything.

Both install dependencies, write `relay/.env`, install the Claude Code hooks, build the glasses app,
open a public HTTPS tunnel, start the relay and make the install QR.

**The tunnel:** with Tailscale installed and signed in (`brew install --cask tailscale`), the relay
gets a permanent `https://<mac>.<tailnet>.ts.net` address through Tailscale Funnel. The first time, Tailscale
prints a link to enable Funnel for your tailnet: open it, then start again. Without Tailscale, a
Cloudflare quick tunnel is used (`brew install cloudflared`). Its address changes on every start,
so you'd scan a new QR each time.

> The glasses can't run Tailscale themselves. Funnel publishes the relay to the normal internet
> over HTTPS, which is what the glasses need. Your token, and the app lock (step 4), keep it private.

## 2. Install on the glasses

Menu bar app → **Install QR** (it refreshes the address and regenerates the QR first), or
`relay/install-qr.png` from `npm run up`.

1. Point your **iPhone camera** at the QR and tap the link.
   It's an `fb-viewapp://web_app_deep_link?...` link. A plain QR of the website is **not** recognized.
2. The Meta AI app shows **Claude Productivity For Meta Display**, marked **unverified** (expected for your own apps).
3. Confirm. It's added to your glasses' apps. Open it from there.

On first launch the app reads the token from the install link, saves it, and removes it from the
address. You should see the home screen and a green dot in the header (relay connected).

**Already on the phone?** Open `https://<your-address>/install?k=<SHELL_TOKEN>` in the phone's browser
and tap **"Tap here instead"**.

> **Keep the QR private.** It contains your `SHELL_TOKEN`. If it leaks, change the token in
> `relay/.env` (the relay restarts by itself) and reinstall from a new QR.

## 3. Updating

| Changed | What happens | Reinstall? |
|---|---|---|
| Glasses UI (`glasses/`) | the app or `npm run up` rebuilds it; the lens reloads itself | No |
| Relay (`relay/`, `shared/`) | the relay restarts by itself | No |
| `relay/.env` | the relay restarts by itself | No |
| Public address or `SHELL_TOKEN` | **Install QR** again and scan | Yes |

## 4. Lock the app

Set `APP_PATTERN` (a swipe pattern) and/or `APP_PASSWORD` in `relay/.env`. Until you unlock, the relay
sends the lens nothing and accepts no commands. An unlock lasts `APP_LOCK_HOURS` (default 12) on that
device. **Settings → app lock** on the lens locks it again right away. See `relay/src/lock.ts`.

## 5. Develop without the glasses

- **Preview:** the menu bar app's **Preview** button, or `http://localhost:8787/?k=<SHELL_TOKEN>`.
  Arrow keys = swipes, Enter = pinch, Escape = back.
- **Simulator:** the **Meta Ray-Ban Display Simulator** Chrome extension recreates the 600×600 additive
  display and D-pad input.
- **Hot reload:** `npm run dev:demo` → `http://localhost:5173/?k=<SHELL_TOKEN>` with fake data.
- **Meta's docs inside Claude Code:** `claude mcp add --transport http meta-wearables https://mcp.developer.meta.com/wearables`

## Input

| Gesture (Neural Band) | Key the app gets | In ClaudeProd |
|---|---|---|
| Thumb swipe up/down/left/right | ArrowUp/Down/Left/Right | move focus and scroll. On an approval: → approve, ← deny, ↓ always. In the message reader: scroll |
| Index pinch | Enter | select |
| Middle-finger tap | back (Escape / browser history) | back. Closes the reply box, locks 2FA codes |
| Text boxes | the system composer | dictate, handwrite or type, then optionally cleaned by Groq |

## Troubleshooting

| Symptom | Fix |
|---|---|
| QR opens a web page instead of the Meta AI app | Use **Install QR** / `npm run qr`, not a QR of the plain address |
| Install fails or "can't open" | The address must be HTTPS with a valid certificate. `http://` and LAN IPs are rejected |
| "No relay token" screen | The app was opened without the install link. Scan the QR again |
| Red dot in the header (relay offline) | Relay stopped or the tunnel is down. Check the menu bar app, or `curl https://<address>/healthz` |
| Stuck on the lock screen | Check `APP_PATTERN` in `relay/.env`. After 5 wrong tries it waits 15 minutes |
| Funnel hangs on first start | Tailscale printed a link to enable Funnel: open it (the menu bar **Log** shows it) |
| Band battery | Not shown: Meta doesn't expose the Neural Band's battery to web apps. The header shows the glasses (`navigator.getBattery()`) and your Mac |
