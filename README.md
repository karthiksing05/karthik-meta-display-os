# Claude Shell for Meta Ray-Ban Display

A Claude-only shell for your glasses: steer several Claude Code sessions, approve with a swipe,
ask "how's everything going?", answer agent questions, and glance at music, calendar, mail,
messages, maps, photos and 2FA codes. No Meta AI anywhere.

```
Meta-Display-Customs/
├── glasses/        the 600×600 web app that runs on the glasses (TypeScript + Vite, no framework)
├── relay/          the server: Claude Agent SDK sessions, approvals, integrations (Node + TypeScript)
├── shared/         protocol.ts, the message types both sides use
├── integrations/   google-apps-script/Code.gs (Calendar + Gmail feed)
├── deploy/         Oracle VM setup, systemd, Cloudflare tunnel, macOS launch agent
└── docs/           how-tos (start with PUSH_TO_GLASSES.md)
```

## Try it in 2 minutes (demo data, no keys)

Needs Node 20+.

```bash
npm run setup                     # install + relay/.env with a random token
npm run dev:demo                  # relay on :8787 (fake data) + hot-reloading app on :5173
```

Open `http://localhost:5173/?k=<SHELL_TOKEN from relay/.env>` in Chrome, ideally with the
**Meta Ray-Ban Display Simulator** extension. Arrow keys = swipes, Enter = pinch, Esc = back.
Demo 2FA unlock pattern: ↑ ↑ ↓ ↓ then Enter.

## Upload it (GitHub → server → glasses)
**→ [UPLOAD.md](UPLOAD.md)**: the end-to-end steps. Details for the glasses part are in
[docs/PUSH_TO_GLASSES.md](docs/PUSH_TO_GLASSES.md).

## Make it real
| | Doc |
|---|---|
| Relay, Claude login, repos, approvals, Oracle deploy | [docs/SERVER.md](docs/SERVER.md) |
| Groq, Spotify, Google, Maps, Messages/WhatsApp, Photos | [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) |
| 2FA codes (opt-in, read first) | [docs/TWO_FACTOR.md](docs/TWO_FACTOR.md) |
| How it fits together, adding screens, phase-0 hardware tests | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

## Screens
home · claude hub (status button, question inbox, ask bar) · sessions · session · new session ·
approval card (→ approve, ← deny, ↓ always) · composer (dictation + Groq cleanup) · comms ·
contact · spotify · agenda · meet · mail · maps/route · photos · photo viewer · 2fa · links · settings

## Commands
| Command | Does |
|---|---|
| `npm run setup` | install everything, create `relay/.env` |
| `npm run dev:demo` / `npm run dev` | hot reload, with fake or real data |
| `npm start` | build the app + run the relay (production) |
| `npm run qr` | install QR for your glasses |
| `npm run deploy` | update the relay on your server after `git push` (needs `DEPLOY_HOST`) |
| `npm run typecheck` | check both halves |
| `npm run 2fa:import -w relay` | import 2FA accounts (see TWO_FACTOR.md) |
