# Roadmap: from Claude monitor to productivity OS

The goal: one shell on the glasses that replaces the Meta app's features, centred on productivity.
The MacBook is the server: it stays on, plugged in and on Wi-Fi, and you use everything from the
glasses while you're away from it. This file is the plan and the record of what's done.

## What "OS" means here

The glasses run Meta's OS, and we can't replace it. Our app is a web app the user opens on the lens.
"OS" means our shell has its own launcher, status bar, notification center, app switcher and
settings, and that once you're in it you don't need to leave.

## Architecture

```
glasses web app (shell)  ◀──WSS over tunnel──▶  ClaudeProd.app on the MacBook (the relay)
                                                  │  Claude sessions (local repos, your login)
iPhone app (later) ──────────────────────────────▶│  BlueBubbles (same Mac)
  mic → voice input, push when lens is asleep     │  Google, Twilio, weather, Groq
                                                  └─ vault, state, all secrets
```

- **The Mac is the source of truth.** All state, the vault and the integrations live there.
- **Assume you are never at the Mac.** Every feature must work from the glasses alone. Nothing may
  need a click, a dialog or a password typed on the Mac.
- **When the Mac is unreachable**, the glasses say so clearly ("Mac offline since 2:14") and the
  last state stays readable. They don't pretend to work.

## Feature by feature

| Feature | How | Notes / risk |
|---|---|---|
| Claude sessions | Existing Agent SDK sessions on the Mac, local repos, your Claude login and connectors | Already built. Cloud sessions (Claude Code on the web) are a later add-on, if an API for them is available |
| Gmail | Gmail API, OAuth refresh token in the relay's encrypted store | Inbox, triage, archive, reply (Claude drafts, you approve on the lens) |
| Google Calendar | Calendar API, same OAuth | Agenda, create/move events, RSVP, reminders as toasts |
| Weather | Open-Meteo (no key) | Location from the iPhone app later; a fixed city in settings until then |
| Voice input (FreeFlow-style) | Port [FreeFlow](https://github.com/zachlatta/freeflow)'s pipeline (MIT): audio → Groq Whisper (or any OpenAI-compatible server) → cleanup with a custom prompt and vocabulary → text on the lens | The web app has no mic and the Mac's mic is at home, so audio has to come from the iPhone app. Until then: Meta's composer + our cleanup (already built) |
| Messages (iMessage) | BlueBubbles server on the same Mac | Works because the Mac is always on. Needs Messages signed in on the Mac |
| WhatsApp | Option A: WhatsApp Business Cloud API (separate number). Option B: unofficial libraries (Baileys) on your own number | B breaks WhatsApp's terms and can get the number banned. Decide before building |
| Phone calls | Twilio click-to-call bridge: relay has Twilio ring your cell, you answer on the glasses, Twilio connects the other person. Your number shows as caller ID once verified | Mac's own Continuity calling won't work: the audio would play on the Mac, not with you. Costs a few cents a minute |
| 2FA codes | Existing vault | Already done |
| Notifications | Relay pushes to the lens; iPhone app gets pushes when the lens is asleep (later) | |

## Phases

### Phase 1: the Mac stays reachable (do first)
- [ ] **Stay awake.** `up.sh` uses `caffeinate -i`, which still lets a closed lid sleep. Add a Mac app
      setting for "keep awake with lid closed" (`caffeinate -s` on power, or `pmset disablesleep` with
      a warning about heat in a bag) and show the current mode in the menu
- [ ] **Start by itself.** Launch at login (`SMAppService`), relaunch the relay if it crashes, restart
      the tunnel after Wi-Fi changes or wake
- [ ] **Survive power cuts.** `pmset autorestart 1`. Note: with FileVault on, after an unplanned
      reboot nothing runs until someone unlocks the Mac. For planned restarts use `fdesetup authrestart`
- [ ] **Fixed URL.** Make Tailscale Funnel the default so the installed app never needs a new QR
- [ ] **Offline screen** on the glasses with "last seen" time and the cached state
- [ ] **Uptime alert.** A free external monitor pings `/healthz` over the tunnel and alerts your phone
- [ ] **No Mac dialogs.** Audit for anything that pops a prompt on the Mac (keychain, permissions,
      osascript) and handle it up front during setup

### Phase 2: the shell
- [ ] App registry in `shared/protocol.ts` (id, name, icon, entry screen, state slice)
- [ ] Relay services as modules (`init`, `state`, `handle`) loaded by `hub.ts`
- [ ] Launcher built from the registry, status bar (time, glasses battery, Mac battery and
      power, connection, "needs you" count)
- [ ] Notification center with history, app switcher, per-app settings

### Phase 3: Google and weather
- [ ] OAuth setup in the Mac app (one-time browser sign-in), encrypted token storage
- [ ] Calendar app: today, next event, create/move, RSVP
- [ ] Gmail app: inbox, read, archive, Claude-drafted replies
- [ ] Weather app

### Phase 4: messaging and calls
- [ ] BlueBubbles app: conversations, read, reply with dictation
- [ ] Twilio click-to-call bridge, call log, call back
- [ ] WhatsApp (after picking option A or B above)

### Phase 5: iPhone app (`ios/`)
- [ ] SwiftUI app, connects to the relay with the same protocol
- [ ] Voice input from the glasses' mic → relay's FreeFlow-style pipeline → shown on the lens
- [ ] Edit mode like FreeFlow's: pick a draft on the lens, speak an instruction, get it rewritten
- [ ] Pushes when the lens is asleep, location for weather
- [ ] First check whether Meta's Wearables Device Access Toolkit gives apps the Display glasses' mic

## Keeping it running permanently

- **Power:** keep the MacBook plugged in. The status bar shows Mac battery so you notice if it isn't.
- **Fixed URL:** Tailscale Funnel gives a stable address, so the glasses app never needs reinstalling.
- **Backups:** nightly encrypted backup of the relay's data dir (vault, OAuth tokens, session records)
  to iCloud Drive or a second disk. Test a restore once.
- **Credentials:** track when each token expires (Claude, Google, Twilio, WhatsApp). The status bar
  shows an orange warning before one does.
- **macOS updates:** they reboot the Mac. Set them to install at night, and because of FileVault, plan
  to be home or use `fdesetup authrestart`. Otherwise you're offline until you unlock it.
- **Updates to this app:** pin dependency versions, run `npm run typecheck` and the demo before
  relaunching, keep the previous build for rollback.
- **Platform risk:** Meta can change the web app platform. Keep the relay independent of it, so most
  of the system survives if the lens app has to be rebuilt.
- **Cloud fallback (optional, later):** the relay can also run on a small server (see UPLOAD.md) if
  you ever want it to work while the Mac is off.

## Open questions
- Closed lid: OK to keep the MacBook awake with the lid shut (`pmset disablesleep`), or will it stay open?
- WhatsApp: business API (safe, separate number) or unofficial (your number, ban risk)?
- Twilio for calls, or is Meta's built-in calling plus a call log enough?
- Does the Wearables Device Access Toolkit support the Display glasses' mic yet?
