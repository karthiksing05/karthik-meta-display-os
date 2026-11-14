# The relay server

`relay/` is a Node + TypeScript server. It:

- serves the built glasses app at `/` and a WebSocket at `/ws` (token required)
- runs **Claude Code sessions** through the Claude Agent SDK, one **git worktree + branch per session**
- turns permission requests into **approval cards** and Claude's questions into the **question inbox**
- gives every session an in-process **glasses MCP server** (`notify`, `show_card`, `ask_choice`)
- answers **"how's everything going?"** across all sessions
- cleans dictation with **Groq**, and polls **Spotify, Google, Maps and iMessage (BlueBubbles)**

It runs anywhere with Node 20+: your Mac to start with, then an Oracle Cloud Always Free VM so it's
up when your laptop sleeps.

## Run it on your Mac

```bash
npm run setup        # npm install + relay/.env with a random SHELL_TOKEN
# edit relay/.env: at least a Claude credential and REPOS_DIR
npm start            # builds the glasses app, starts the relay on :8787
```

Then give it an HTTPS address and install it on the glasses (see `PUSH_TO_GLASSES.md`).

To start it at login, use `deploy/com.claudeshell.relay.plist` (instructions inside).

## Claude credentials

Pick one in `relay/.env`:

- **Your Claude subscription:** install Claude Code (`npm i -g @anthropic-ai/claude-code`), run
  `claude setup-token`, and paste the token into `CLAUDE_CODE_OAUTH_TOKEN`.
- **API key:** `ANTHROPIC_API_KEY` from console.anthropic.com (billed per use).

Sessions load your normal Claude Code settings (`~/.claude`, each repo's `CLAUDE.md`, MCP servers
and connectors), so anything you set up for Claude Code works here too.

## Repos and worktrees

- `REPOS_DIR` (default `~/code`): every subfolder with a `.git` shows up under **new session** on the lens.
- Each session runs `git worktree add -b shell/<task>-<id> <WORKTREES_DIR>/<repo>-<task>-<id>`.
  Claude works and commits there. **It never pushes**: pushing is on the always-ask list.
- Merge when you're happy: `git merge shell/<task>-<id>` in the repo (or ask a session to open a PR).
- Clean up old worktrees: `git worktree list` / `git worktree remove <path>`.

Sessions survive relay restarts: they come back as *stopped*, and sending a message resumes the
same Claude conversation.

## Approvals (no rules editor)

One preset, set in **Settings → approvals** on the lens:

| Preset | Allows without asking |
|---|---|
| careful | reading files |
| **balanced** (default) | reads, edits inside the session's worktree, tests, builds, lint, `git status/diff/log/add/commit` |
| trusting | everything except the dangerous list |

**↓ always** on an approval card teaches the preset a rule, for example `Bash(npm run migrate *)`.
These show in Settings, and **forget learned** clears them.

**Always asks, whatever you've set:** `rm -rf`, `sudo`, `git push`, `git reset --hard`, `curl … | sh`,
`ssh/scp`, `npm publish`, anything touching `.env`, and edits outside the worktree. Logic is in
`relay/src/approvals.ts`; tweak the lists there if you want.

## Deploy to Oracle Cloud (free, always on)

1. Create an **Always Free** VM (Ubuntu 24.04; Ampere A1 if available).
2. Put this project on GitHub (private is fine), then on the VM:
   ```bash
   REPO_URL=https://github.com/<you>/claude-shell.git bash <(curl -fsSL https://raw.githubusercontent.com/<you>/claude-shell/main/deploy/oracle-setup.sh)
   ```
   or copy `deploy/oracle-setup.sh` over and run it.
3. Edit `~/claude-shell/relay/.env`, clone your repos into `~/code`, run
   `sudo systemctl restart claude-shell`.
4. `sudo tailscale up && sudo tailscale funnel --bg 8787` gives you a free HTTPS URL. Put it in `PUBLIC_URL`.
5. `npm run qr` and scan it.

Logs: `journalctl -u claude-shell -f`. Backups: copy `~/.claude-shell/data` (tokens, rules, contacts).

## Security notes

- Everything goes through one secret, `SHELL_TOKEN`. It's in the install link, so treat the QR like a password.
- The relay can run commands through Claude. Keep the approval preset on **balanced** or **careful**
  until you trust your setup.
- Text from mail, messages and web pages can contain instructions aimed at Claude (prompt injection).
  The approval card is your check: read what a session wants to run before you swipe →.
- Want a second lock? Put Cloudflare Access in front of the tunnel, or restrict Funnel.

## Endpoints

| Path | Auth | What |
|---|---|---|
| `/` | none (static UI) | glasses app |
| `/ws?k=TOKEN` | token | all live data and commands (see `shared/protocol.ts`) |
| `/install?k=TOKEN` | token | install QR page |
| `/spotify/login?k=TOKEN` | token | one-time Spotify login |
| `/api/maps/static?k=TOKEN` | token | map image for the current route |
| `/healthz` | none | returns `ok` |
