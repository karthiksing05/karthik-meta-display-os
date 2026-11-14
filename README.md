# Claude Shell for Meta Ray-Ban Display

Claude Code session monitoring for your glasses: see every session on your Mac (including terminal,
VS Code and Remote Control), approve with a swipe, answer questions, ask "how's everything going?",
and reply by voice. Music, maps, messages and photos are left to the glasses' own apps.

```
Meta-Display-Customs/
├── glasses/        the 600×600 web app that runs on the glasses (TypeScript + Vite, no framework)
├── relay/          the server: Claude Agent SDK sessions, approvals, integrations (Node + TypeScript)
├── shared/         protocol.ts, the message types both sides use
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

## Upload it (GitHub → server → glasses)
**→ [UPLOAD.md](UPLOAD.md)**: the end-to-end steps. Details for the glasses part are in
[docs/PUSH_TO_GLASSES.md](docs/PUSH_TO_GLASSES.md).

## Make it real
| | Doc |
|---|---|
| Relay, Claude login, repos, approvals, Oracle deploy | [docs/SERVER.md](docs/SERVER.md) |
| How it fits together, adding screens, phase-0 hardware tests | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

## Screens
home · claude hub (status button, question inbox, ask bar) · sessions · session · new session ·
approval card (→ approve, ← deny, ↓ always) · composer (dictation + optional Groq cleanup) · settings

## Commands
| Command | Does |
|---|---|
| `npm run up` | **everything in one go**: build, tunnel, relay, install QR. Leave it running: edits go live (`-- --demo` for fake data) |
| `npm run doctor` | checks relay, URL, Claude login, repos and hooks; says what to fix |
| `npm run 2fa` | import 2FA accounts for the lens (opt-in, read [docs/TWO_FACTOR.md](docs/TWO_FACTOR.md) first) |
| `npm run hooks -- install` | show all your Claude Code sessions (terminal, VS Code, Remote Control) on the lens |
| `npm run setup` | install everything, create `relay/.env` |
| `npm run dev:demo` / `npm run dev` | hot reload, with fake or real data |
| `npm start` | build the app + run the relay (production) |
| `npm run qr` | install QR for your glasses |
| `npm run deploy` | update the relay on your server after `git push` (needs `DEPLOY_HOST`) |
| `npm run typecheck` | check both halves |
