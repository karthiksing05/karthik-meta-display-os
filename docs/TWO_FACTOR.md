# 2FA codes on the lens (opt-in)

**Read this before turning it on.**

Google Authenticator has no API and no plugin system: no other app can read its codes. The only way
to see codes on the glasses is to **copy the secrets out of Authenticator into the relay**, which then
computes the same 6-digit codes (standard TOTP, RFC 6238).

### The trade-off
2FA works because the code lives on a separate device (your phone). Copying the secrets to a server
you reach over the internet makes that server a second place an attacker could get them from.
Someone who gets **both** your relay (token + unlock pattern, or the encrypted vault + passphrase)
**and** your password gets past 2FA.

**Recommendation:** import only low-stakes accounts (Discord, dev tools, side projects). Keep **Google,
Apple ID, bank, email and password manager** in Authenticator only. Prefer running the relay on
your Mac over the VM for this.

### How it's protected
- Secrets are encrypted on disk (AES-256-GCM). The key comes from `TOTP_PASSPHRASE`.
- Codes are never part of the shared state. They're computed on request and sent only to the screen that unlocked.
- Unlocking needs your swipe pattern (`TOTP_UNLOCK`, use 6+ moves). It lasts **60 seconds** and
  re-locks when you leave the screen.
- **5 wrong patterns → locked for 15 minutes** (logged on the relay).
- And everything is still behind `SHELL_TOKEN` and HTTPS.

### Set it up
1. In `relay/.env`:
   ```
   TOTP_PASSPHRASE=<long random passphrase, NOT your SHELL_TOKEN>
   TOTP_UNLOCK=up up left right down left
   ```
2. Export from Google Authenticator: **⋮ → Transfer accounts → Export accounts**, then pick the accounts
   (low-stakes ones only). It shows a QR code.
3. Turn that QR into a link: scan it with another device's camera and copy the text. It starts
   `otpauth-migration://offline?data=`. You can also paste single `otpauth://totp/...` links from a site's 2FA setup.
4. On the relay machine:
   ```bash
   cd relay && npm run 2fa:import
   ```
   Paste the link(s), then press Enter on an empty line. Check with `npm run 2fa:import -- --list`.
5. Restart the relay. Then **delete every copy of the export QR and link** (screenshots, notes, clipboard history).

On the lens: **home → 2fa**, swipe your pattern, pinch. Codes show with a countdown.

To remove accounts: `npm run 2fa:import -- --remove GitHub`. To remove everything, delete
`~/.claude-shell/data/totp.enc`. Your accounts stay in Google Authenticator either way: exporting
copies them, it doesn't move them.
