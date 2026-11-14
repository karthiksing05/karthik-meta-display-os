# Architecture

```
┌──────────── glasses (600×600 web app) ────────────┐       ┌──────────── relay (Node) ─────────────┐
│ screens render from one state snapshot            │  WSS  │ hub: state + broadcast                 │
│ nav.ts: arrows / Enter / back → spatial focus     │◀────▶ │ sessions.ts: Agent SDK query() per     │
│ store.ts: socket, token, glasses battery          │       │   session, worktree, canUseTool        │
│ compose: system composer → Groq cleanup → send    │       │ approvals.ts: preset + learned rules   │
└───────────────────────────────────────────────────┘       │ glassesMcp.ts: notify/show_card/ask    │
                                                            │ status.ts: "how's everything going?"   │
                                                            │ external.ts: your other sessions       │
                                                            │   (terminal/VS Code/RC) via hooks      │
                                                            └────────────────────────────────────────┘
```

- **One protocol file:** `shared/protocol.ts`. Both sides import it, so a type change shows up in both.
- **Snapshots, not patches:** the relay sends the whole `ShellState` (it's small) on every change,
  at most every 150 ms. The app re-renders and puts focus back on the same control by its `data-f` key.
- **Glasses stay thin:** all secrets, keys and logic live on the relay. The lens only draws and sends intents.
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

## Phase 0 checklist (on the real glasses)
- [ ] Arrow, Enter and back events arrive as expected; spatial focus feels right
- [ ] Does a **held pinch** reach web apps? (could be push-to-talk)
- [ ] System composer dictation quality for code-ish speech (before vs after Groq)
- [ ] `navigator.getBattery()` works; Neural Band battery: confirm it's not exposed
- [ ] WebSocket stays up across lens sleep/wake (the app reconnects with backoff)
- [ ] Gray vs black background: readability outdoors, battery
