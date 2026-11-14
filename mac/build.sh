#!/usr/bin/env bash
# Build the ClaudeProd menu bar app ("Claude Productivity For Meta Display") and install it in ~/Applications.
#
#   npm run app            build, install, open
#   npm run app -- --no-open
#
# Needs only the Xcode Command Line Tools (swiftc, iconutil, codesign); no Xcode project.
# The app runs deploy/up.sh from THIS folder, so rebuild if you move the repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/mac/build"
APP="$OUT/ClaudeProd.app"
DEST="$HOME/Applications/ClaudeProd.app"
OLD="$HOME/Applications/Claude Shell.app"   # its name before the rename
OPEN=1
[ "${1:-}" = "--no-open" ] && OPEN=0

say() { printf '\033[38;2;255;97;136m==>\033[0m %s\n' "$*"; }
command -v swiftc >/dev/null || { echo "swiftc not found: xcode-select --install"; exit 1; }

say "Compiling"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -parse-as-library \
  -target "$(uname -m)-apple-macos14.0" \
  -o "$APP/Contents/MacOS/ClaudeShell" \
  "$ROOT"/mac/ClaudeShell/*.swift

say "Drawing the icon"
ICONSET="$OUT/AppIcon.iconset"
rm -rf "$ICONSET"
"$APP/Contents/MacOS/ClaudeShell" --make-icon "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
cp "$ICONSET/icon_512x512@2x.png" "$OUT/icon-1024.png"

VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json" 2>/dev/null || echo 0.1.0)"
# The PATH of the shell running this build, so the app finds node (nvm), npm, claude, tailscale…
APP_PATH="$PATH"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ClaudeProd</string>
  <key>CFBundleDisplayName</key><string>Claude Productivity For Meta Display</string>
  <key>CFBundleIdentifier</key><string>dev.claudeshell.menubar</string>
  <key>CFBundleExecutable</key><string>ClaudeShell</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$(xml "$VERSION")</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>ClaudeShellRepo</key><string>$(xml "$ROOT")</string>
  <key>ClaudeShellPath</key><string>$(xml "$APP_PATH")</string>
</dict>
</plist>
EOF

say "Signing (ad hoc, for this Mac)"
codesign --force --deep --sign - "$APP" >/dev/null

say "Installing to ~/Applications"
mkdir -p "$HOME/Applications"
# Quit a running copy first, so the new one takes over (and reopen it after, even with --no-open).
pgrep -f "Contents/MacOS/ClaudeShell" >/dev/null && OPEN=1
osascript -e 'tell application id "dev.claudeshell.menubar" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "$DEST" "$OLD"
cp -R "$APP" "$DEST"
# Make Finder / Launchpad pick up the new icon.
touch "$DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST" >/dev/null 2>&1 || true

if [ "$OPEN" = 1 ]; then
  open "$DEST"
  say "ClaudeProd is in your menu bar (the rainbow asterisk)."
else
  say "Built: $DEST"
fi
