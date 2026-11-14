#!/usr/bin/env bash
# Update the relay on your server after `git push`.
#   DEPLOY_HOST=ubuntu@<VM-IP> npm run deploy
# Optional: DEPLOY_DIR (default ~/claude-shell on the server).
set -euo pipefail

HOST="${DEPLOY_HOST:-}"
DIR="${DEPLOY_DIR:-~/claude-shell}"

if [ -z "$HOST" ]; then
  echo "Set DEPLOY_HOST, e.g.  DEPLOY_HOST=ubuntu@1.2.3.4 npm run deploy"
  exit 1
fi

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "Warning: you have uncommitted changes. They will NOT be deployed (the server pulls from GitHub)."
fi
if [ -n "$(git log @{u}.. --oneline 2>/dev/null)" ]; then
  echo "Warning: you have commits that aren't pushed. Run 'git push' first."
fi

echo "==> Updating $HOST:$DIR"
ssh "$HOST" bash -s <<EOF
set -euo pipefail
cd $DIR
git pull --ff-only
npm install --no-audit --no-fund
npm run build
sudo systemctl restart claude-shell
sleep 3
curl -fsS http://localhost:8787/healthz >/dev/null && echo "relay is up" || { echo "relay did not come back; see: journalctl -u claude-shell -n 50"; exit 1; }
EOF
echo "==> Done. Reopen Claude Shell on your glasses to load the new version."
