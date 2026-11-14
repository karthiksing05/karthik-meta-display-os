#!/usr/bin/env bash
# One command from this Mac to an install QR for the glasses:
#   npm run up              real mode (Claude sessions on your repos)
#   npm run up -- --demo    fake data, no keys needed
#
# It: installs deps if needed · writes relay/.env · helps you add a Claude token and repos folder ·
# builds the glasses app · opens a public HTTPS tunnel (Tailscale Funnel if set up, else a
# Cloudflare quick tunnel) · starts the relay · makes the QR and opens it. Ctrl-C stops everything.
#
# Leave it running while you code: edits to glasses/ rebuild and the lens reloads itself; edits to
# relay/, shared/ or relay/.env restart the relay. The tunnel (and so the QR) stays the same.
#
# Options: --demo  --tunnel tailscale|cloudflare  --no-prompt  --no-watch  --no-open
# (The ClaudeProd menu bar app runs this with --no-prompt --no-open.)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$ROOT/relay/.env"
LOGS="$ROOT/relay/.logs"
DEMO=0
TUNNEL=""
PROMPT=1
WATCH=1
OPEN=1
[ -t 0 ] || PROMPT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO=1 ;;
    --tunnel) TUNNEL="${2:-}"; shift ;;
    --no-prompt) PROMPT=0 ;;
    --no-watch) WATCH=0 ;;
    --no-open) OPEN=0 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

say()  { printf '\033[38;2;255;97;136m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[38;2;253;151;31m  !\033[0m %s\n' "$*"; }
die()  { printf '\033[38;2;255;97;136m  x\033[0m %s\n' "$*"; exit 1; }

# Read / write one KEY=value in relay/.env (node avoids sed escaping problems with URLs and tokens).
env_get() { node -e 'const fs=require("fs");const m=fs.readFileSync(process.argv[1],"utf8").match(new RegExp("^"+process.argv[2]+"=(.*)$","m"));process.stdout.write(m?m[1].trim():"")' "$ENV" "$1"; }
env_set() {
  node -e 'const fs=require("fs");const [f,k,v]=process.argv.slice(1);let s=fs.readFileSync(f,"utf8");const re=new RegExp("^"+k+"=.*$","m");s=re.test(s)?s.replace(re,()=>k+"="+v):s.replace(/\n?$/,"\n"+k+"="+v+"\n");fs.writeFileSync(f,s,{mode:0o600})' "$ENV" "$1" "$2"
}

cd "$ROOT"
mkdir -p "$LOGS"

# ---------- 1. tools + dependencies ----------
say "Checking tools"
command -v node >/dev/null || die "Node 20+ is required (brew install node)"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node 20+ is required (you have $(node -v))"
if [ ! -d node_modules ] || [ ! -d glasses/node_modules/vite ]; then
  say "Installing dependencies"
  npm install --no-audit --no-fund
fi

# ---------- 2. relay/.env ----------
[ -f "$ENV" ] || npm run setup -w relay >/dev/null
chmod 600 "$ENV"
PORT="$(env_get PORT)"; PORT="${PORT:-8787}"

if [ "$DEMO" = 0 ]; then
  # Claude credential (only for CLAUDE_AUTH=token; the default login mode uses your Claude Code login)
  if [ "$(env_get CLAUDE_AUTH)" = "token" ] && [ -z "$(env_get CLAUDE_CODE_OAUTH_TOKEN)" ] && [ -z "$(env_get ANTHROPIC_API_KEY)" ]; then
    if [ "$PROMPT" = 1 ] && command -v claude >/dev/null; then
      say "No Claude credential in relay/.env yet"
      echo "    'claude setup-token' opens your browser, signs in with your Claude subscription,"
      echo "    and prints a long-lived token that starts with sk-ant-oat01-."
      read -r -p "    Run it now? [Y/n] " yn
      if [ "${yn:-y}" != "n" ] && [ "${yn:-y}" != "N" ]; then
        claude setup-token || warn "claude setup-token exited with an error"
        echo
        read -r -s -p "    Paste the token (input hidden, Enter to skip): " tok; echo
        tok="$(printf '%s' "$tok" | tr -d '[:space:]')"
        if [[ "$tok" == sk-ant-* ]]; then env_set CLAUDE_CODE_OAUTH_TOKEN "$tok"; say "Saved CLAUDE_CODE_OAUTH_TOKEN to relay/.env"
        elif [ -n "$tok" ]; then warn "That doesn't look like a Claude token (should start with sk-ant-). Not saved."
        fi
      fi
    fi
    if [ -z "$(env_get CLAUDE_CODE_OAUTH_TOKEN)" ] && [ -z "$(env_get ANTHROPIC_API_KEY)" ]; then
      warn "No Claude credential: the app will load, but new sessions won't start. (Or use --demo.)"
    fi
  fi

  # Repos folder
  REPOS="$(env_get REPOS_DIR)"; REPOS="${REPOS:-~/code}"
  REPOS_ABS="${REPOS/#\~/$HOME}"
  if [ ! -d "$REPOS_ABS" ]; then
    if [ "$PROMPT" = 1 ]; then
      DEF="$(dirname "$ROOT")"
      say "REPOS_DIR ($REPOS) doesn't exist"
      echo "    Every subfolder with a .git inside this folder shows up under 'new session' on the lens."
      read -r -p "    Folder with your repos [$DEF]: " pick
      pick="${pick:-$DEF}"; pick="${pick/#\~/$HOME}"
      [ -d "$pick" ] || die "$pick doesn't exist"
      env_set REPOS_DIR "$pick"; REPOS_ABS="$pick"
    else
      warn "REPOS_DIR $REPOS doesn't exist: no repos will show on the lens"
    fi
  fi
  if [ -d "$REPOS_ABS" ]; then
    say "Repos folder: $REPOS_ABS (npm run doctor counts the repos found)"
  fi
fi

# Hooks: show every Claude Code session on this Mac live on the lens (idempotent).
if [ "$DEMO" = 0 ] && ! grep -q '.claude-shell/hook.sh' "$HOME/.claude/settings.json" 2>/dev/null; then
  say "Installing Claude Code hooks (all your sessions show on the lens)"
  npm run hooks -s -- install >/dev/null || warn "Couldn't install hooks (npm run hooks -- install)"
fi

# ---------- 3. build the glasses app ----------
say "Building the glasses app"
npm run build >"$LOGS/build.log" 2>&1 || { tail -30 "$LOGS/build.log"; die "Build failed (log: relay/.logs/build.log)"; }

# ---------- 4. public HTTPS address ----------
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "Port $PORT is already in use (another relay running?). Stop it, or change PORT in relay/.env."
fi

PIDS=()
killtree() { local c; for c in $(pgrep -P "$1" 2>/dev/null); do killtree "$c"; done; kill "$1" 2>/dev/null || true; }
cleanup() {
  echo; say "Stopping"
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && killtree "$p"; done
  [ "${FUNNEL_ON:-0}" = 1 ] && tailscale funnel --https=443 off >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

ts_ready() { command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; }
if [ -z "$TUNNEL" ]; then ts_ready && TUNNEL=tailscale || TUNNEL=cloudflare; fi

URL=""
case "$TUNNEL" in
  tailscale)
    ts_ready || die "Tailscale isn't installed or logged in (brew install --cask tailscale, then sign in)"
    say "Opening Tailscale Funnel on :$PORT (stable URL)"
    # Shown on screen: the first time, Tailscale prints a link to enable Funnel and waits for it.
    tailscale funnel --bg "$PORT" 2>&1 | tee "$LOGS/tunnel.log" || { die "Funnel failed. If it printed a link, open it to enable Funnel for your tailnet, then re-run."; }
    FUNNEL_ON=1
    URL="https://$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"
    ;;
  cloudflare)
    command -v cloudflared >/dev/null || die "cloudflared not found (brew install cloudflared)"
    say "Opening a Cloudflare quick tunnel on :$PORT"
    warn "Quick-tunnel URLs change on every run, so you'll rescan the QR each time. Tailscale gives a fixed one."
    cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$LOGS/tunnel.log" 2>&1 &
    PIDS+=($!)
    for _ in $(seq 1 40); do
      URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGS/tunnel.log" | head -1 || true)"
      [ -n "$URL" ] && break; sleep 1
    done
    [ -n "$URL" ] || { tail -20 "$LOGS/tunnel.log"; die "cloudflared didn't report a URL"; }
    ;;
  *) die "--tunnel must be tailscale or cloudflare" ;;
esac
say "Public URL: $URL"
env_set PUBLIC_URL "$URL"

# ---------- 5. relay ----------
say "Starting the relay$([ "$DEMO" = 1 ] && echo ' (demo mode)')"
if [ "$WATCH" = 1 ]; then
  say "Watching glasses/ for changes (rebuilds; the lens reloads itself)"
  ( cd glasses && exec npx vite build --watch ) >"$LOGS/glasses-watch.log" 2>&1 &
  PIDS+=($!)
  ( cd relay && DEMO="$DEMO" exec npx tsx watch --clear-screen=false --include .env src/index.ts ) >"$LOGS/relay.log" 2>&1 &
else
  ( cd relay && DEMO="$DEMO" exec npx tsx src/index.ts ) >"$LOGS/relay.log" 2>&1 &
fi
RELAY=$!
PIDS+=($RELAY)
# Keep the Mac awake while the relay runs (lid-open; a closed lid on battery still sleeps).
caffeinate -i -w "$RELAY" &
PIDS+=($!)

for _ in $(seq 1 30); do curl -fsS "http://localhost:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://localhost:$PORT/healthz" >/dev/null 2>&1 || { tail -30 "$LOGS/relay.log"; die "Relay didn't start (log: relay/.logs/relay.log)"; }

say "Waiting for $URL to answer"
ok=0
for _ in $(seq 1 45); do curl -fsS "$URL/healthz" >/dev/null 2>&1 && { ok=1; break; }; sleep 2; done
[ "$ok" = 1 ] || warn "The public URL isn't answering yet (DNS can lag a minute). The QR is still valid."

# ---------- 6. QR ----------
npm run qr -w relay -- "$URL" 2>/dev/null | grep -v '^>' || die "QR generation failed"
[ "$OPEN" = 1 ] && { open "$ROOT/relay/install-qr.png" 2>/dev/null || true; }

cat <<EOF
$(say "Ready")
  1. iPhone camera → scan the QR → the Meta AI app asks to add "Claude Productivity For Meta Display" (unverified is expected).
  2. Open ClaudeProd on the glasses. Green dot in the header = connected.
  Logs: relay/.logs/relay.log · relay/.logs/tunnel.log     Ctrl-C stops the relay and tunnel.
$([ "$WATCH" = 1 ] && echo "  Keep this running while you edit: changes go live without rescanning.")
EOF

wait "$RELAY"
