#!/usr/bin/env bash
# Claude Shell relay on an Oracle Cloud Always Free VM (Ubuntu 22.04/24.04, Ampere A1 or AMD).
# Run on the VM as the default `ubuntu` user:
#   curl -fsSL <raw url of this file> | bash        (or copy it over and `bash oracle-setup.sh`)
# Then follow the printed next steps. Safe to re-run.
set -euo pipefail

REPO_URL="${REPO_URL:-}"            # e.g. https://github.com/<you>/claude-shell.git (private is fine with a token)
APP_DIR="${APP_DIR:-$HOME/claude-shell}"

echo "==> Packages"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates build-essential

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v tailscale >/dev/null; then
  echo "==> Tailscale (gives the relay a free, stable HTTPS address via Funnel)"
  curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "==> Code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
elif [ -n "$REPO_URL" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  echo "Set REPO_URL=... or copy the project to $APP_DIR (e.g. rsync from your Mac), then re-run."
  exit 1
fi

cd "$APP_DIR"
npm install
npm run build
[ -f relay/.env ] || npm run setup -w relay

mkdir -p "$HOME/code" "$HOME/.claude-shell"
git config --global user.name  >/dev/null || git config --global user.name  "Claude Shell"
git config --global user.email >/dev/null || git config --global user.email "claude-shell@localhost"

echo "==> systemd service"
sudo tee /etc/systemd/system/claude-shell.service >/dev/null <<EOF
[Unit]
Description=Claude Shell relay
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR/relay
ExecStart=$(command -v npm) start
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now claude-shell

cat <<'NEXT'

Done. Next steps:
  1. Edit ~/claude-shell/relay/.env  (CLAUDE_AUTH=token + CLAUDE_CODE_OAUTH_TOKEN, APP_PATTERN, optional Groq key)
     then: sudo systemctl restart claude-shell
  2. Clone the repos you want Claude to work on into ~/code
  3. Public HTTPS address (free, stable):
       sudo tailscale up            # log in once
       sudo tailscale funnel --bg 8787
     Your URL is https://<machine-name>.<tailnet>.ts.net  → put it in PUBLIC_URL in .env
  4. Install on the glasses: cd ~/claude-shell && npm run qr
     (or open https://<your-url>/install?k=<SHELL_TOKEN> on your laptop and scan)

Logs:   journalctl -u claude-shell -f
NEXT
