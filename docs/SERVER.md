# The relay server

`relay/` is a Node + TypeScript server. It:

- serves the built glasses app at `/` and a WebSocket at `/ws` (token required)
- runs **Claude Code sessions** through the Claude Agent SDK, one **git worktree + branch per session**
- turns permission requests into **approval cards** and Claude's questions into the **question inbox**
- gives every session an in-process **glasses MCP server** (`notify`, `show_card`, `ask_choice`)
- answers **"how's everything going?"** across all sessions
- shows your other Claude Code sessions (terminal, VS Code, Remote Control) through hooks
- keeps your laptop's own windows in sync with sessions the glasses continued
- locks the whole app behind a swipe pattern or password (optional, recommended)
- cleans dictated replies with **Groq** (optional)

It runs on your Mac (the normal setup), or on an always-on server ([UPLOAD.md](../UPLOAD.md)).

## Run it

- **Menu bar app:** `npm run app` builds ClaudeProd.app, which runs `deploy/up.sh` and keeps it running.
- **Terminal:** `npm run up` (Ctrl-C stops it). Options: `--demo`, `--tunnel tailscale|cloudflare`,
  `--no-watch`, `--no-open`, `--no-prompt`.

Both write `relay/.env`, install the hooks, build the glasses app, open the tunnel, start the relay in
watch mode (edits to `glasses/`, `relay/`, `shared/` and `relay/.env` go live by themselves) and make
the install QR. `npm run doctor` checks the whole setup.

## Claude credentials

`CLAUDE_AUTH` in `relay/.env`:

- **`login` (default):** sessions use your Claude Code login on this Mac (`claude` → `/login`),
  including your claude.ai connectors. Nothing to paste.
- **`token`:** for a server with no login. Run `claude setup-token` on your Mac and paste the token into
  `CLAUDE_CODE_OAUTH_TOKEN`, or set `ANTHROPIC_API_KEY` (billed per use). Connectors don't load this way.

Sessions load your normal Claude Code settings (`~/.claude`, each repo's `CLAUDE.md`, MCP servers
and connectors), so anything you set up for Claude Code works here too.

## Repos and worktrees

- `REPOS_DIR` (default `~/code`): every git repo up to 3 levels down shows up under **new session**
  on the lens, most recently used first.
- Each session runs `git worktree add -b shell/<task>-<id> <WORKTREES_DIR>/<repo>-<task>-<id>`.
  Claude works and commits there. **It never pushes**: pushing is on the always-ask list.
- Merge when you're happy: `git merge shell/<task>-<id>` in the repo (or ask a session to open a PR).
- Clean up old worktrees: `git worktree list` / `git worktree remove <path>`.

Sessions survive relay restarts: they come back as *stopped*, and sending a message resumes the
same Claude conversation.

## Your other Claude Code sessions (terminal, VS Code, Remote Control)

The relay also shows every other Claude Code session on its machine, tagged `ext` on the lens.
Remote Control sessions count: they run the normal CLI on your Mac.

```bash
npm run hooks -- install     # adds hooks to ~/.claude/settings.json (backup kept); `remove` undoes it
```

- **Live status:** prompts, tool use, todo progress and "done" arrive through the hooks. Sessions from
  before the hooks (last 24 h) are listed from `~/.claude/projects` via the Agent SDK.
- **Approvals and questions:** while the glasses app is open, permission prompts and
  `AskUserQuestion` come to the lens (up to 10 min, then the normal prompt takes over). With the
  app closed, nothing changes at your desk.
- **Messages:** if the session is working, your message is delivered when it finishes the current
  step (its Stop hook hands it to Claude). If it's idle, replying **continues that same session**
  (same ID, same conversation, same row). Pick it up again at your desk (`claude --resume`, or keep
  typing in Remote Control) and it's handed back. Avoid typing in it at the desk *while* the
  relay is running it.
- Pause and stop stay with wherever the session runs. The hook script does nothing when the relay
  is down, and the relay's own sessions skip it.

### Keeping your laptop in sync

An open VS Code tab or terminal never re-reads its conversation from disk, so it can't show turns the
glasses added. The relay (`relay/src/desk.ts`) watches which sessions are open on the Mac (each VS Code
Claude tab runs `claude --resume=<id>`; the hooks report the rest), and:

- after the glasses finish a turn on a laptop session that **isn't** open there, it waits 15 s, lets go
  of the session and opens it in VS Code (`vscode://anthropic.claude-code/open?session=<id>`) or
  Terminal, freshly loaded. Turn this off with **settings → laptop sync** on the lens.
- if a tab **is** open, it's out of date: the lens says so. Close it, then **open on laptop**.
- **open on laptop** on a session screen does the same on demand.

## Chats, quick phrases, connectors

- **chat** (hub, sessions, or new): a one-off with no repo, in its own folder under `~/.claude-shell/chats`.
  Sessions use your Claude Code login (`CLAUDE_AUTH=login`, the default), so your claude.ai connectors
  (Gmail, Calendar, Drive, Slack, …) are available. Connect or authorize them at claude.ai → Settings →
  Connectors; new ones show up in the next chat. Connector calls ask for approval like any tool; use
  "↓ always" for the ones you trust. `CLAUDE_AUTH=token` uses the token instead (servers), without connectors.
- **Quick phrases** (continue, lgtm, elaborate, draft plan, summarize): one pinch sends them to a session, or from the hub
  to the session picked with ▾ ("active sessions" = working or open and waiting, never stopped ones).
  Edit `~/.claude-shell/data/phrases.json`; changes show within seconds.
- **How's everything going?** runs a one-turn summary: a 2-3 sentence overview and a line or two per
  session, each with **since last**, what changed since the previous check (kept in
  `DATA_DIR/last-status.json`). Everything scrolls, and pinching the overview opens it in the reader.
  The summary is never saved as a Claude session, so it doesn't pile up in your session lists.

## Approvals (no rules editor)

One preset, set in **Settings → approvals** on the lens:

| Preset | Allows without asking |
|---|---|
| careful | reading files |
| **balanced** (default) | reads, edits inside the session's worktree, tests, builds, lint, `git status/diff/log/add/commit` |
| trusting | everything except the dangerous list |
| everything | everything, the dangerous list included (nothing asks, in any session) |

**↓ always** on an approval card teaches the preset a rule, for example `Bash(npm run migrate *)`.
These show in Settings, and **forget learned** clears them.

**Always asks, unless the preset is *everything*:** `rm -rf`, `sudo`, `git push`, `git reset --hard`, `curl … | sh`,
`ssh/scp`, `npm publish`, anything touching `.env`, and edits outside the worktree. Logic is in
`relay/src/approvals.ts`; tweak the lists there if you want.

## Always on

To keep sessions reachable while the Mac sleeps, run the relay on a free Oracle Cloud VM instead:
see [UPLOAD.md](../UPLOAD.md). Logs there: `journalctl -u claude-shell -f`. Back up `~/.claude-shell/data`.

## App lock

`APP_PATTERN` (a swipe pattern) and/or `APP_PASSWORD` in `relay/.env` lock the whole app
(`relay/src/lock.ts`):

- A new connection gets nothing (no sessions, no state) and can only send `app.unlock`.
- The right pattern or password returns a signed pass for that device (`APP_LOCK_HOURS`, default 12),
  which it sends when it reconnects. Changing the pattern, password or `SHELL_TOKEN` voids every pass.
- 5 wrong tries lock everyone out for 15 minutes (logged on the relay).
- **Settings → app lock** on the lens forgets the pass right away.

## Security notes

- `SHELL_TOKEN` is in the install link, so treat the QR like a password. Turn on the app lock as well,
  so a leaked link alone isn't enough.
- The relay can run commands through Claude. Keep the approval preset on **balanced** or **careful**
  until you trust your setup. *everything* removes the approval check entirely.
- Text from mail, messages and web pages can contain instructions aimed at Claude (prompt injection).
  The approval card is your check: read what a session wants to run before you swipe →.

## Endpoints

| Path | Auth | What |
|---|---|---|
| `/` | none (static UI) | glasses app |
| `/ws?k=TOKEN[&s=PASS]` | token (+ app-lock pass) | all live data and commands (see `shared/protocol.ts`) |
| `/install?k=TOKEN` | token | install QR page |
| `/hooks` (POST) | token header | Claude Code hook events from your other sessions |
| `/status.json?k=TOKEN` | token | small summary for the menu bar app (counts, address; no session content) |
| `/healthz` | none | returns `ok` |
