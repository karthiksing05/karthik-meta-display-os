# Running the relay on an always-on server

The normal setup runs the relay on your Mac (see the [README](README.md)). That's simplest, and it's
the only way to see the Claude Code sessions you run on that Mac. When the Mac sleeps, though, the
glasses can't reach the relay.

If you want ClaudeProd available all the time, for sessions it starts itself, you can run the relay
on a free Oracle Cloud VM instead. The glasses only care about the address.

```
Mac (this folder) ──git push──▶ GitHub ──git pull──▶ relay server ──HTTPS──▶ glasses
```

> A server relay can't see your Mac's terminal, VS Code or Remote Control sessions on its own (those
> run on the Mac), and laptop sync doesn't apply. Any machine you can SSH into (your Mac included) can
> report its sessions to it with `npm run hooks -- remote user@host`, run from a checkout whose
> `relay/.env` has the server's `PUBLIC_URL` and `SHELL_TOKEN`. Sessions started from the glasses run on the server, in
> the repos you clone there.

## 1. Set up the VM

1. Create an **Always Free** Ubuntu 24.04 VM at cloud.oracle.com (Ampere A1 if available). Add your
   SSH key and note its public IP.
2. If your fork is private, let the VM pull it with a read-only deploy key:
   ```bash
   ssh ubuntu@<VM-IP>
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
   ```
   Add that key at **GitHub → repo → Settings → Deploy keys → Add** (read-only).
3. On the VM:
   ```bash
   git clone git@github.com:<you>/<repo>.git ~/claude-shell
   bash ~/claude-shell/deploy/oracle-setup.sh
   ```
   It installs Node and Tailscale, builds the app, writes `relay/.env` and starts a systemd service.
4. Fill in `~/claude-shell/relay/.env`:
   - a Claude credential: there's no Claude Code login on a server, so set `CLAUDE_AUTH=token` and
     `CLAUDE_CODE_OAUTH_TOKEN` (run `claude setup-token` on your Mac and paste it). Connectors don't load in token mode.
   - `REPOS_DIR` (clone the repos you want Claude to work on into it)
   - **`APP_PATTERN`** or `APP_PASSWORD`: a server is always reachable, so lock it
5. Then:
   ```bash
   sudo tailscale up && sudo tailscale funnel --bg 8787    # prints your HTTPS address: put it in PUBLIC_URL
   sudo systemctl restart claude-shell
   curl https://<your-address>/healthz                      # should print: ok
   cd ~/claude-shell && npm run qr                          # scan it with your iPhone camera
   ```

## 2. Updating

Push from the Mac, then update the VM with one command:

```bash
git push
DEPLOY_HOST=ubuntu@<VM-IP> npm run deploy
```

`npm run deploy` (`deploy/update.sh`) connects over SSH, pulls, installs, rebuilds the glasses app,
restarts the service and checks `/healthz`. The glasses pick up the new version the next time
the app opens.

| You changed | Reinstall on the glasses? |
|---|---|
| Anything in `glasses/`, `relay/`, `shared/` | No. Deploy, then reopen the app |
| `relay/.env` keys | No. `sudo systemctl restart claude-shell` |
| `PUBLIC_URL` or `SHELL_TOKEN` | **Yes**: `npm run qr` and scan again |

## Troubleshooting

| Problem | Fix |
|---|---|
| VM can't clone | Deploy key missing, or you used the `https://` URL instead of `git@github.com:` |
| Red dot in the app header | Relay down or tunnel off: `curl https://<address>/healthz`, `journalctl -u claude-shell -f` |
| Sessions fail with an auth error | `CLAUDE_AUTH=token` and a valid `CLAUDE_CODE_OAUTH_TOKEN` in `relay/.env` |
