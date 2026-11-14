# Uploading Claude Shell: Mac → GitHub → server → glasses

There are three uploads, done in this order:

1. **Code → GitHub**, so the server can pull it.
2. **Code → relay server** (your Mac, or the free Oracle VM), which serves the app over HTTPS.
3. **App → glasses**: you install a link once, by QR code. After that, updates reach the glasses on their own.

```
Mac (this folder) ──git push──▶ GitHub ──git pull──▶ relay server ──HTTPS──▶ glasses
```

Detailed references: [docs/PUSH_TO_GLASSES.md](docs/PUSH_TO_GLASSES.md) ·
[docs/SERVER.md](docs/SERVER.md)

---

## Before you start

| Need | Check |
|---|---|
| Node 20+ on the Mac | `node -v` (install: `brew install node`) |
| Git + GitHub CLI | `git --version`, `gh --version` (install: `brew install gh`, then `gh auth login`) |
| Meta AI app v272+ | Meta AI app → Settings → App Info → App version |
| Glasses v125+ | Devices → your glasses → gear icon → General → About → Release Version |
| Developer Mode on | Meta AI app → Settings → App Info → tap **App version** 5 times → **Enable** |

---

## Step 1: Put the code on GitHub

From this folder on your Mac:

```bash
cd ~/Documents/Independent-Projects/Meta-Display-Customs
npm install                          # also checks that the project installs cleanly
git init -b main
git add .
git commit -m "Claude Shell v0.1"
gh repo create claude-shell --private --source=. --push
```

**Keep the repo private.** It holds no secrets (`relay/.env` and tokens are in
`.gitignore`), but there's no reason to publish your setup. Check that nothing secret slipped in:

```bash
git ls-files | grep -E '\.env$|install-qr' || echo "clean"
```

## Step 2: Run the relay

Pick one. You can start on the Mac and move to the VM later. The glasses only care about the URL.

### Option A: on your Mac (fastest to try)

```bash
npm run setup          # creates relay/.env with a random SHELL_TOKEN
# edit relay/.env: CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`), REPOS_DIR, other keys
npm start              # builds the glasses app + starts the relay on :8787
```

Give it an HTTPS address in a second terminal:

```bash
brew install tailscale && sudo tailscale up      # once
sudo tailscale funnel --bg 8787                  # → https://<mac-name>.<tailnet>.ts.net
```

Put that URL in `relay/.env` as `PUBLIC_URL=…`, then restart `npm start`.
(For a quick test you can use `cloudflared tunnel --url http://localhost:8787` instead, but that URL changes every run.)

To keep it running after reboots, use `deploy/com.claudeshell.relay.plist` (instructions inside the file).

### Option B: on the free Oracle VM (always on)

1. Create an **Always Free** Ubuntu 24.04 VM at cloud.oracle.com. Add your SSH key and note its public IP.
2. Let the VM pull your private repo. On the VM, create a read-only deploy key:
   ```bash
   ssh ubuntu@<VM-IP>
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
   ```
   Add that key on GitHub: **repo → Settings → Deploy keys → Add** (read-only).
3. Still on the VM, run the setup script from your repo:
   ```bash
   git clone git@github.com:<you>/claude-shell.git ~/claude-shell
   bash ~/claude-shell/deploy/oracle-setup.sh
   ```
   It installs Node and Tailscale, builds the app, writes `relay/.env` and starts a systemd service.
4. Fill in `~/claude-shell/relay/.env` (same keys as the Mac), clone the repos you want Claude to
   work on into `~/code`, then:
   ```bash
   sudo tailscale up && sudo tailscale funnel --bg 8787    # → your HTTPS URL; put it in PUBLIC_URL
   sudo systemctl restart claude-shell
   curl https://<your-url>/healthz                          # should print: ok
   ```

## Step 3: Install it on the glasses

On whichever machine runs the relay:

```bash
npm run qr
```

This prints a QR code and saves `relay/install-qr.png`. Then:

1. Point your **iPhone camera** at the QR code and tap the link.
2. The Meta AI app opens and asks to add **Claude Shell**. It's labeled *unverified* because it's
   your own app; that's expected.
3. Confirm, then open Claude Shell from your glasses' apps. Look for the green dot in the header (relay connected).

No QR handy? Open `https://<your-url>/install?k=<SHELL_TOKEN>` in a browser and scan it from there.

> The QR code contains your token: don't share or screenshot it into shared places.

---

## Updating after you change code

The glasses load the app from your URL each time, so **you never reinstall** unless the URL or token changes.

**Relay on the Mac:** `git commit` your changes, then restart `npm start`. Close and reopen the app on the glasses.

**Relay on the VM:** push from the Mac, then update the VM with one command:

```bash
git push
DEPLOY_HOST=ubuntu@<VM-IP> npm run deploy
```

`npm run deploy` (see `deploy/update.sh`) SSHes in, pulls, installs, rebuilds the glasses app,
restarts the service and checks `/healthz`. Put `DEPLOY_HOST=ubuntu@<VM-IP>` in your shell profile to
skip typing it.

| You changed | Reinstall on the glasses? |
|---|---|
| Anything in `glasses/`, `relay/`, `shared/` | No. Deploy, then reopen the app |
| `relay/.env` keys | No. Restart the relay |
| `PUBLIC_URL` or `SHELL_TOKEN` | **Yes**: `npm run qr` and scan again |

## Quick troubleshooting

| Problem | Fix |
|---|---|
| `gh repo create` fails | Run `gh auth login` first |
| VM can't clone | Deploy key missing, or you used the `https://` URL instead of `git@github.com:` |
| QR opens a web page, not the Meta AI app | Use the QR from `npm run qr` / `/install`; a QR of the plain URL won't work |
| App says "No relay token" | It was opened without the install link. Scan the QR again |
| Red dot in the app header | Relay down or tunnel off: check `curl https://<url>/healthz` and `journalctl -u claude-shell -f` |
