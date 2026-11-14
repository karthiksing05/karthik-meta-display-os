# Architecture

```
┌──────── glasses (600×600 web app) ────────┐        ┌──────────── relay (Node, on your Mac) ─────────────┐
│ screens render from one state snapshot    │  WSS   │ hub.ts: state + broadcast, phrases, Mac battery    │
│ nav.ts: arrows / Enter / back → focus     │◀──────▶│ lock.ts: app lock (pattern/password → device pass) │
│ store.ts: socket, token, lock pass        │        │ sessions.ts: Agent SDK query() per session         │
│ composer: system text input → Groq → send │        │ approvals.ts: preset + learned rules               │
│ pixels.ts: the swirl band                 │        │ external.ts: terminal/VS Code/RC sessions (hooks)  │
└───────────────────────────────────────────┘        │ desk.ts: which sessions are open on the laptop     │
                                                     │ status.ts: "how's everything going?"               │
┌──── ClaudeProd.app (menu bar, Swift) ─────┐ runs   │ totp.ts: encrypted 2FA vault                       │
│ starts deploy/up.sh, polls /status.json,  │───────▶│ glassesMcp.ts: notify / show_card / ask_choice     │
│ install QR, checkup, logs, settings       │        └─────────────────────────────────────────────────────┘
└───────────────────────────────────────────┘
```

- **One protocol file:** `shared/protocol.ts`. Both sides import it, so a type change shows up in both.
- **Snapshots, not patches:** the relay sends the whole `ShellState` (it's small) on every change,
  at most every 150 ms. The app re-renders and puts focus back on the same control by its `data-f` key.
- **Glasses stay thin:** all secrets, keys and logic live on the relay. The lens only draws and sends intents.
- **Locked by default when configured:** with an app lock set, a connection gets nothing until it unlocks (`lock.ts`).
- **Claude only:** nothing uses Meta AI. WebMCP and Meta's connectors aren't used, because they serve Meta AI.

## How a permission request reaches your wrist
1. A session calls a tool → the SDK calls `canUseTool`.
2. `approvals.decide()` checks the preset and learned rules. Safe → allowed silently.
3. Otherwise an `Approval` (title, command or diff, the rule "↓ always" would save) is added to the state,
   and a toast says "X needs approval".
4. You swipe on the card → `approval.decide` → the promise resolves → the tool runs, or is refused.

`AskUserQuestion` and `mcp__glasses__ask_choice` go to the **question inbox** on the Claude hub
the same way, and your answer is returned to Claude as the tool result.

## Adding a screen
1. `glasses/src/screens/<name>.ts`: `register('<name>', { render, mount, key? })`.
2. Give every control a stable `data-f` key (use `btn()`), so focus survives re-renders.
3. Import it in `main.ts` and link to it with `go('<name>', params)`.
4. Long text: make each block focusable (focus drives scrolling), or open it in the `message` reader.

## Phase 0 checklist (on the real glasses)
- [ ] Arrow, Enter and back events arrive as expected; spatial focus feels right
- [ ] Does a **held pinch** reach web apps? (could be push-to-talk)
- [ ] System composer dictation quality for code-ish speech (before vs after Groq)
- [ ] `navigator.getBattery()` works (the Neural Band's battery isn't exposed to web apps, per Meta's docs)
- [ ] WebSocket stays up across lens sleep/wake (the app reconnects with backoff)
- [ ] Gray vs black background: readability outdoors, battery
