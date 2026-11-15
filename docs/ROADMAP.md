# Roadmap: from Claude monitor to productivity OS

The goal: one shell on the glasses that replaces the Meta app's features, centred on productivity,
that keeps working when the laptop is off. This file is the plan and the record of what's done.

## What "OS" means here

The glasses run Meta's OS, and we can't replace it. Our app is a web app the user opens on the lens.
"OS" means our shell has its own launcher, status bar, notification center, app switcher and
settings, and that once you're in it you don't need to leave.

## Target architecture

```
glasses web app (shell)  ◀──WSS──▶  cloud relay (always on)  ◀──▶  Google, WhatsApp, Twilio, weather,
                                          ▲      ▲                 Claude (Agent SDK), Groq
                                          │      │
                        iPhone app ───────┘      └─────── Mac node (optional, when online):
                        mic → voice input,                local repos, terminal sessions,
                        push, background sync             BlueBubbles, desk sync
```

- **Cloud relay is the source of truth.** All state, the vault and the integrations live there.
- **The Mac and the iPhone are clients/nodes**, not servers. They connect out to the relay. When one is
  offline, its features say so and everything else keeps working.

## Feature by feature: what's possible

| Feature | How | Needs Mac? | Notes / risk |
|---|---|---|---|
| Cloud Claude sessions | Agent SDK on the relay, repos cloned from GitHub into the server's disk | No | Auth with `CLAUDE_CODE_OAUTH_TOKEN` or an API key. Sessions push to branches and open PRs |
| Laptop Claude sessions | Existing hooks + sessions, through the Mac node | Yes | Shows "Mac offline" when asleep |
| Gmail | Gmail API, OAuth refresh token on the relay | No | Inbox, triage, archive, reply (Claude drafts, you approve) |
| Google Calendar | Calendar API, same OAuth | No | Agenda, create/move events, RSVP, reminders as toasts |
| Weather | Open-Meteo (no key) | No | Location from the iPhone app, or a fixed city in settings |
| Voice input ("free flow") | iPhone app records the glasses' mic over Bluetooth → Groq Whisper → Claude cleanup → relay | No | The web app has no mic, so this needs the iPhone app. Check Wispr Flow for a public API; if none, our own pipeline does the same job |
| Messages (iMessage) | BlueBubbles server | **Yes, always-on Mac** | iMessage only works from a Mac. Use a cheap always-on Mac mini, or accept that it's off when the laptop is |
| WhatsApp | Option A: WhatsApp Business Cloud API (separate business number). Option B: unofficial libraries (Baileys) on your own number | No | B breaks WhatsApp's terms and can get the number banned. Decide before building |
| Phone calls | The glasses already handle calls through the phone. We add a call log, "call back" and Claude summaries. Real dialing from our app: Twilio VoIP number + CallKit in the iPhone app | No | iOS doesn't let apps place or answer cellular calls silently. Twilio costs money per minute |
| 2FA codes | Existing vault | No | Already done |
| Notifications | Relay pushes to the lens; iPhone app gets APNs pushes when the lens is asleep | No | |

## Phases

### Phase 1: always on (do first)
- [ ] Move the relay to a cloud host (a small VPS such as Hetzner, or Fly.io) with a fixed domain and TLS
- [ ] Docker image + `deploy/cloud/` scripts; systemd or the platform's restart policy
- [ ] Split Mac-only code (`desk.ts`, `host.ts`, `external.ts`, the osascript parts of `sessions.ts`)
      into a **Mac node** that connects out to the relay
- [ ] Cloud Claude sessions: clone repos from GitHub, worktree per session, push to branches
- [ ] "Mac offline" states everywhere a Mac feature appears

### Phase 2: the shell
- [ ] App registry in `shared/protocol.ts` (id, name, icon, entry screen, state slice)
- [ ] Relay services as modules (`init`, `state`, `handle`) loaded by `hub.ts`
- [ ] Launcher built from the registry, status bar (time, battery, relay, Mac, "needs you" count)
- [ ] Notification center with history, app switcher, per-app settings

### Phase 3: Google
- [ ] OAuth flow on the relay (one-time setup from a browser), encrypted token storage
- [ ] Calendar app: today, next event, create/move, RSVP
- [ ] Gmail app: inbox, read, archive, Claude-drafted replies
- [ ] Weather app

### Phase 4: iPhone app (`ios/`)
- [ ] SwiftUI app, connects to the relay with the same protocol
- [ ] Voice input from the glasses' mic → Groq → relay → shown on the lens
- [ ] APNs push, location for weather, background refresh
- [ ] Check Meta's Wearables Device Access Toolkit for Display support (mic, maybe more)

### Phase 5: messaging and calls
- [ ] BlueBubbles via the Mac node (or a dedicated Mac mini)
- [ ] WhatsApp (after picking option A or B above)
- [ ] Call log + Twilio/CallKit calling if wanted

## Keeping it running permanently

- **Hosting:** one small always-on server, auto-restart, OS updates on. Budget roughly $5–10/month
  plus any Twilio usage.
- **Fixed URL:** your own domain. The installed glasses app points at it, so the host can change
  without reinstalling on the lens.
- **Backups:** nightly encrypted backup of the relay's data dir (vault, OAuth tokens, session
  records) to a second place. Test a restore once.
- **Monitoring:** an uptime check that pings `/status.json` and alerts your phone if it's down.
- **Credentials:** note when each token expires (Claude OAuth token, Google refresh token, WhatsApp).
  The status bar should show an orange warning before one expires.
- **Updates:** pin dependency versions, upgrade on purpose, run `npm run typecheck` and the demo
  before each deploy. Keep a one-command rollback to the previous image.
- **Platform risk:** Meta can change the web app platform. Keep the relay and the iPhone app
  independent of it, so most of the system survives if the lens app has to be rebuilt.
- **Fallback:** the relay still runs on the Mac (`npm run up`), so if the server is down you can
  point the glasses at the laptop.

## Open questions
- WhatsApp: business API (safe, separate number) or unofficial (your number, ban risk)?
- iMessage: buy an always-on Mac mini, or accept Messages only when the laptop is on?
- Calls: is the built-in Meta calling plus our call log enough, or do you want Twilio?
- Does the Wearables Device Access Toolkit support the Display glasses' mic yet?
