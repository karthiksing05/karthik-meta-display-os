# ClaudeProd (Claude Productivity For Meta Display): notes for Claude Code

A web app for Meta Ray-Ban Display glasses (`glasses/`), a Node relay (`relay/`) and a macOS menu bar
app that runs it (`mac/`, Swift, built by `npm run app`). Read
`docs/ARCHITECTURE.md` first.

## Hard constraints of the glasses
- Fixed **600×600** viewport, additive display (black = transparent). No scrolling the page itself;
  only `main.scroll` areas scroll, driven by focus.
- Input is only **ArrowUp/Down/Left/Right, Enter, and back** (Escape/history). Every control must be a
  focusable element with a stable `data-f` key (use `btn()` from `glasses/src/ui.ts`). No hover, no mouse.
- Text input comes from the system composer through `<textarea>` `change` events.
- Favicons must be PNG (≥52 px), not SVG. Keep `<meta name="mrbd-web-app-capable" content="yes">`.
- No camera or microphone in web apps. Glasses battery: `navigator.getBattery()`.

## Conventions
- Monokai roles: pink = focus/main action, orange = needs you, green = running/on, yellow = names,
  cyan = labels, purple = numbers, grey = comments. Font: JetBrains Mono.
- Protocol changes go in `shared/protocol.ts` first; both sides typecheck against it.
- The relay sends full state snapshots; screens are pure `render(params) → html` + `mount()` for handlers.
- Secrets and API keys live only on the relay.
- Scope: Claude session monitoring, plus opt-in 2FA codes (docs/TWO_FACTOR.md). Don't add features the glasses' own OS already has
  (music, maps, messages, calls, photos).
- Claude only: never add Meta AI, WebMCP or Meta connector integrations.

## Checks
`npm run typecheck`, then `npm run dev:demo` and click through with the arrow keys.
Mac app changes: `npm run app` (rebuilds, reinstalls and relaunches it). README screenshots use demo data only
(the repo is public): never commit screenshots, logs or text from real sessions, `relay/.env` or the QR.

## Meta docs from inside Claude Code
`claude mcp add --transport http meta-wearables https://mcp.developer.meta.com/wearables`
(tool: `search_webapps_docs`)
