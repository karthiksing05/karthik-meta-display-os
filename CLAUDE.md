# ClaudeProd: notes for Claude Code

A productivity OS shell for Meta Ray-Ban Display glasses. It replaces the Meta app's own features with
one Claude-centred shell that works whether or not the laptop is on. Parts:

- `glasses/`: the 600×600 web app (the shell the user sees)
- `relay/`: the Node server. **It runs in the cloud and is always on.** It holds all state, secrets and
  integrations
- `mac/`: optional Mac node (menu bar app, local repos, BlueBubbles, terminal sessions). Not required
- `ios/` (planned): iPhone companion app for the things a web app can't do (mic, push, background)

Read `docs/ARCHITECTURE.md` first, then `docs/ROADMAP.md` for the plan and phase status.

## Goal and scope
- An OS-style shell with a clear focus on productivity: launcher, status bar, notification center,
  app switcher, settings, plus these apps:
  - Claude sessions: cloud sessions first, with laptop sessions when the Mac is online
  - Gmail and Google Calendar (all of it: read, triage, reply, create/edit events, invites)
  - Messages through BlueBubbles, WhatsApp, phone calls, weather
  - Voice input that is better than Meta's dictation, modelled on FreeFlow
    (github.com/zachlatta/freeflow, MIT): transcribe with Groq or any OpenAI-compatible server, then
    clean it up with a custom prompt and vocabulary. The pipeline runs on the relay
  - 2FA codes (docs/TWO_FACTOR.md) and anything else an average OS has that helps productivity
- Duplicating what the glasses' OS already does is now **allowed** when our version is better or
  keeps everything in one place.
- **Always works:** no feature may depend on the laptop being awake. Anything Mac-only (local repos,
  desk sync, terminal hooks, BlueBubbles) must show "Mac offline" and degrade, never break the shell.
- Claude only for AI: never add Meta AI, WebMCP or Meta connector integrations. Speech-to-text
  providers (Groq Whisper etc.) are fine.

## Hard constraints of the glasses web app
- Fixed **600×600** viewport, additive display (black = transparent). No scrolling the page itself;
  only `main.scroll` areas scroll, driven by focus.
- Input is only **ArrowUp/Down/Left/Right, Enter, and back** (Escape/history). Every control must be a
  focusable element with a stable `data-f` key (use `btn()` from `glasses/src/ui.ts`). No hover, no mouse.
- Text input comes from the system composer through `<textarea>` `change` events.
- **No camera or microphone in the web app.** Our own voice input must come from the iPhone app,
  never from browser APIs on the lens.
- Favicons must be PNG (≥52 px), not SVG. Keep `<meta name="mrbd-web-app-capable" content="yes">`.
- Glasses battery: `navigator.getBattery()`.

## Conventions
- Monokai roles: pink = focus/main action, orange = needs you, green = running/on, yellow = names,
  cyan = labels, purple = numbers, grey = comments. Font: JetBrains Mono.
- Protocol changes go in `shared/protocol.ts` first; the glasses, relay and iOS app all follow it.
- The relay sends full state snapshots; screens are pure `render(params) → html` + `mount()` for handlers.
- Each app is a relay service (`init`, `state`, `handle(intent)`) plus one or more glasses screens,
  listed in the app registry. Don't hardcode new apps into `main.ts` or `home.ts`.
- Secrets, OAuth refresh tokens and API keys live only on the relay, encrypted at rest. Never on the
  lens, never in the repo.
- Every integration needs a demo mode with fake data so `npm run dev:demo` works with no accounts.

## Privacy (the repo is public)
- Never commit screenshots, logs, emails, messages, calendar events, contacts or text from real
  sessions, `relay/.env`, OAuth credentials or the install QR. README screenshots use demo data only.

## Checks
`npm run typecheck`, then `npm run dev:demo` and click through with the arrow keys.
Relay deploys: see `docs/ROADMAP.md` (hosting). Mac app changes: `npm run app`.

## Meta docs from inside Claude Code
`claude mcp add --transport http meta-wearables https://mcp.developer.meta.com/wearables`
(tool: `search_webapps_docs`)
