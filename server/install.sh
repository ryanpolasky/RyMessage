#!/bin/bash
# Builds RyMessage Server and runs it in the background: starts at login, restarts if it quits.
set -euo pipefail
cd "$(dirname "$0")"

LABEL="app.rymessage.server"
DOMAIN="gui/$(id -u)"
INSTALL_DIR="$HOME/Library/Application Support/RyMessage"
BINARY="$INSTALL_DIR/rymessage-server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/RyMessage"
LOG="$LOG_DIR/server.log"
CONFIG="$HOME/.rymessage/config.json"

step() { printf "\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n" "$1"; }
note() { printf "    %s\n" "$1"; }
config_value() { plutil -extract "$1" raw -o - "$CONFIG" 2>/dev/null || true; }

if [[ "$(uname)" != "Darwin" ]]; then
  echo "RyMessage Server only runs on macOS."
  exit 1
fi

step "Checking Apple's developer tools"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  note "A window just opened to install Apple's command line tools."
  note "Run ./install.sh again once that finishes."
  exit 1
fi
SWIFT_MAJOR="$(swift --version 2>/dev/null | sed -nE 's/.*Swift version ([0-9]+)\..*/\1/p' | head -n 1)"
if [[ -z "$SWIFT_MAJOR" || "$SWIFT_MAJOR" -lt 6 ]]; then
  note "These tools have Swift ${SWIFT_MAJOR:-unknown}, and RyMessage needs Swift 6 or newer."
  TOOLS_UPDATE="$(softwareupdate --list 2>&1 | sed -nE 's/^\* Label: (Command Line Tools.*)$/\1/p' | tail -n 1)"
  if [[ -z "$TOOLS_UPDATE" ]]; then
    note "No update is offered. Reinstall the tools, then run ./install.sh again:"
    note "  sudo rm -rf /Library/Developer/CommandLineTools && xcode-select --install"
    exit 1
  fi
  answer=""
  read -r -p "    Install $TOOLS_UPDATE now? [Y/n] " answer || true
  if [[ "$answer" =~ ^[Nn] ]]; then
    exit 1
  fi
  softwareupdate --install "$TOOLS_UPDATE"
fi
note "Found Swift $(swift --version 2>/dev/null | sed -nE 's/.*Swift version ([0-9.]+).*/\1/p' | head -n 1)."

step "Building (the first build downloads dependencies and takes a few minutes)"
note "A warning about XCTest paths is expected with the command line tools and is harmless."
swift build -c release
BUILT="$(swift build -c release --show-bin-path)/RyMessageServer"

step "Installing"
mkdir -p "$INSTALL_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
# bootout returns before the old service is fully gone, and registering again too early fails
for _ in $(seq 1 30); do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 0.5
done
note "$BINARY"

# permissions follow the signature, so a fixed certificate in its own locked keychain keeps them without letting other apps impersonate the server
SIGNING_IDENTITY="RyMessage Local Signing"
SIGNING_KEYCHAIN="$HOME/Library/Keychains/rymessage-signing.keychain-db"
SIGN_LOG="$(mktemp)"
create_signing_keychain() {
  local dir password confirm result
  note "Choose a password for RyMessage's signing keychain. You'll type it when an update changes the server."
  while true; do
    read -r -s -p "    New password: " password
    echo
    read -r -s -p "    Again: " confirm
    echo
    [[ -n "$password" && "$password" == "$confirm" ]] && break
    note "Those didn't match (or were empty). Try again."
  done
  dir="$(mktemp -d)"
  cat > "$dir/cert.conf" <<CONF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $SIGNING_IDENTITY
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CONF
  { echo "step: create certificate" &&
    /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$dir/cert.conf" \
      -keyout "$dir/key.pem" -out "$dir/cert.pem" &&
    echo "step: package certificate" &&
    /usr/bin/openssl pkcs12 -export -inkey "$dir/key.pem" -in "$dir/cert.pem" -name "$SIGNING_IDENTITY" \
      -out "$dir/identity.p12" -passout pass:rymessage &&
    echo "step: create keychain" &&
    security create-keychain -p "$password" "$SIGNING_KEYCHAIN" &&
    security set-keychain-settings -lut 300 "$SIGNING_KEYCHAIN" &&
    echo "step: import certificate" &&
    security import "$dir/identity.p12" -k "$SIGNING_KEYCHAIN" -P rymessage -T /usr/bin/codesign &&
    echo "step: allow codesign" &&
    security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$SIGNING_KEYCHAIN"; } >"$SIGN_LOG" 2>&1
  result=$?
  rm -rf "$dir"
  if [[ $result != 0 ]]; then
    security delete-keychain "$SIGNING_KEYCHAIN" >/dev/null 2>&1 || true
  fi
  return $result
}
sign_binary() {
  local unlocked="" result
  for _ in 1 2 3; do
    if security unlock-keychain "$SIGNING_KEYCHAIN"; then
      unlocked="yes"
      break
    fi
    note "That password didn't unlock it. Try again."
  done
  if [[ -z "$unlocked" ]]; then
    echo "step: unlock keychain (password not accepted)" >>"$SIGN_LOG"
    return 1
  fi
  # codesign only finds identities in keychains on the search list, so it's added just while signing
  local -a original
  eval "original=($(security list-keychains -d user))"
  security list-keychains -d user -s "${original[@]}" "$SIGNING_KEYCHAIN"
  local fingerprint
  fingerprint="$(security find-identity -p codesigning "$SIGNING_KEYCHAIN" 2>/dev/null |
    awk -v name="\"$SIGNING_IDENTITY\"" 'index($0, name) { print $2; exit }')"
  { echo "step: sign" &&
    codesign --force --keychain "$SIGNING_KEYCHAIN" --sign "${fingerprint:-$SIGNING_IDENTITY}" \
      --identifier app.rymessage.server "$BINARY"; } >>"$SIGN_LOG" 2>&1
  result=$?
  if [[ $result != 0 ]]; then
    security find-identity -p codesigning "$SIGNING_KEYCHAIN" 2>&1 | grep "$SIGNING_IDENTITY" | head -n 1 >>"$SIGN_LOG"
  fi
  security list-keychains -d user -s "${original[@]}"
  security lock-keychain "$SIGNING_KEYCHAIN" >/dev/null 2>&1 || true
  return $result
}
signed_by_us() { codesign -dv "$BINARY" 2>&1 | grep -q "Authority=$SIGNING_IDENTITY"; }

BUILT_HASH="$(LC_ALL=C shasum -a 256 "$BUILT" | awk '{ print $1 }')"
if [[ -f "$BINARY" && "$(cat "$INSTALL_DIR/.build-hash" 2>/dev/null || true)" == "$BUILT_HASH" ]] &&
  { [[ ! -f "$SIGNING_KEYCHAIN" ]] || signed_by_us; }; then
  note "The server hasn't changed since the last install, so it's kept as is."
else
  # overwriting in place keeps the old signature cached for that file and macOS kills the new binary, so replace the file instead
  rm -f "$BINARY"
  cp "$BUILT" "$BINARY"
  echo "$BUILT_HASH" > "$INSTALL_DIR/.build-hash"
  if [[ ! -f "$SIGNING_KEYCHAIN" ]]; then
    create_signing_keychain || true
  fi
  if [[ -f "$SIGNING_KEYCHAIN" ]]; then
    note "Enter the signing keychain password to sign the new server."
    sign_binary || true
  fi
  CERT_PEM="$INSTALL_DIR/signing-certificate.pem"
  if ! signed_by_us && [[ -f "$SIGNING_KEYCHAIN" ]] &&
    security find-certificate -c "$SIGNING_IDENTITY" -p "$SIGNING_KEYCHAIN" >"$CERT_PEM" 2>/dev/null; then
    note "codesign wants the certificate trusted for code signing. macOS asks for your password once."
    if security add-trusted-cert -p codeSign -k "$SIGNING_KEYCHAIN" "$CERT_PEM" >>"$SIGN_LOG" 2>&1; then
      note "Trusted. Enter the signing keychain password again to sign."
      sign_binary || true
    else
      note "Trusting needs the Mac's own screen, which an SSH session can't show. Once, in Terminal through"
      note "Screen Sharing, run this and then ./install.sh again:"
      note "  security add-trusted-cert -p codeSign -k \"$SIGNING_KEYCHAIN\" \"$CERT_PEM\""
    fi
  fi
  if signed_by_us; then
    note "Signed with your local certificate, so macOS keeps its permissions."
  else
    note "Couldn't sign with the local certificate, so macOS may ask for permissions again. It stopped at:"
    grep -v '^\s*$' "$SIGN_LOG" | tail -n 4 | sed 's/^/      /'
  fi
fi
rm -f "$SIGN_LOG"
"$BINARY" --pairing-code >/dev/null

port_in_use() { nc -z -G 1 127.0.0.1 "$1" >/dev/null 2>&1; }
port_owner() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $1 }' | sort -u | paste -sd "," - | sed 's/,/, /g'
}
PORT="$(config_value port)"
if port_in_use "$PORT"; then
  OWNER="$(port_owner "$PORT")"
  FREE="$PORT"
  while port_in_use "$FREE"; do
    FREE=$((FREE + 1))
  done
  note "Port $PORT is already taken by ${OWNER:-another app}, so RyMessage will use $FREE."
  "$BINARY" --set-port "$FREE" | sed 's/^/    /'
fi

CURRENT_URL="$(config_value advertisedURL)"
if [[ -z "$CURRENT_URL" || "$CURRENT_URL" =~ ^http://100\. ]]; then
  TAILSCALE=""
  for candidate in tailscale /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
    if command -v "$candidate" >/dev/null 2>&1; then
      TAILSCALE="$candidate"
      break
    fi
  done
  TAILSCALE_IP="$([[ -n "$TAILSCALE" ]] && "$TAILSCALE" ip -4 2>/dev/null | head -n 1 || true)"
  # the App Store build of Tailscale has no CLI on the PATH, so fall back to its 100.64.0.0/10 interface address
  if [[ -z "$TAILSCALE_IP" ]]; then
    TAILSCALE_IP="$(ifconfig 2>/dev/null | awk '$1 == "inet" && $2 ~ /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./ { print $2; exit }')"
  fi
  # a MagicDNS name keeps working even if the Mac is ever re-added to the tailnet with a new address
  TAILSCALE_NAME=""
  if [[ -n "$TAILSCALE_IP" ]]; then
    TAILSCALE_NAME="$(dig +short +time=2 +tries=1 -x "$TAILSCALE_IP" @100.100.100.100 2>/dev/null | head -n 1 | sed 's/\.$//' || true)"
  fi
  TAILSCALE_URL="http://${TAILSCALE_NAME:-$TAILSCALE_IP}:$(config_value port)"
  if [[ -n "$TAILSCALE_IP" && "$CURRENT_URL" != "$TAILSCALE_URL" ]]; then
    answer=""
    read -r -p "    Use your Tailscale address (${TAILSCALE_NAME:-$TAILSCALE_IP}) in the pairing code? [Y/n] " answer || true
    if [[ ! "$answer" =~ ^[Nn] ]]; then
      "$BINARY" --set-advertised-url "$TAILSCALE_URL" | sed 's/^/    /'
    fi
  fi
fi

step "Setting it to start automatically"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BINARY</string>
        <string>serve</string>
        <string>--env</string>
        <string>production</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
</dict>
</plist>
PLIST
touch "$LOG"
chmod 600 "$LOG"
START_LINE=$(($(wc -l < "$LOG") + 1))
for attempt in $(seq 1 10); do
  if BOOTSTRAP_ERROR="$(launchctl bootstrap "$DOMAIN" "$PLIST" 2>&1)"; then
    break
  fi
  if [[ $attempt == 10 ]]; then
    echo "Couldn't register the background service: $BOOTSTRAP_ERROR"
    echo "Try: launchctl bootstrap $DOMAIN \"$PLIST\""
    exit 1
  fi
  sleep 1
done
launchctl enable "$DOMAIN/$LABEL"
note "Starts when you log in and restarts itself if it ever quits."

PORT="$(config_value port)"
TOKEN="$(config_value token)"
capabilities() {
  curl -fsS -m 3 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/v1/capabilities" 2>/dev/null || true
}
wait_for_server() {
  for _ in $(seq 1 30); do
    local body
    body="$(capabilities)"
    if [[ -n "$body" ]]; then
      echo "$body"
      return 0
    fi
    sleep 1
  done
  return 1
}
restart_server() {
  START_LINE=$(($(wc -l < "$LOG") + 1))
  launchctl kickstart -k "$DOMAIN/$LABEL"
}

step "Starting"
if ! CAPS="$(wait_for_server)"; then
  echo "The server didn't come up. Last log lines:"
  tail -n 20 "$LOG"
  exit 1
fi
note "Running on port $PORT."

if [[ "$CAPS" != *'"sendText":true'* ]]; then
  step "One-time permission: Full Disk Access"
  note "macOS keeps your messages private until you allow RyMessage to read them."
  note "1. System Settings is opening at Privacy & Security > Full Disk Access."
  note "2. A Finder window is opening with rymessage-server selected."
  note "3. Drag rymessage-server into the list and make sure its switch is on."
  note "   Already listed from an earlier install? Remove it with the minus button, then add it again."
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
  open -R "$BINARY"
  while true; do
    read -r -p "    Press Return once it's switched on... " _ || true
    restart_server
    CAPS="$(wait_for_server || true)"
    if [[ "$CAPS" == *'"sendText":true'* ]]; then
      note "RyMessage can read your messages now."
      break
    fi
    note "Still no access. Check that rymessage-server is in the list and switched on."
  done
fi

step "One-time permission: sending through Messages"
note "If macOS asks whether rymessage-server may control Messages, click OK."
automation=""
for _ in $(seq 1 90); do
  recent="$(tail -n +"$START_LINE" "$LOG")"
  if [[ "$recent" == *"Messages automation is allowed"* ]]; then
    automation="yes"
    break
  fi
  if [[ "$recent" == *"Messages automation isn't allowed"* ]]; then
    automation="no"
    break
  fi
  sleep 1
done
if [[ "$automation" == "yes" ]]; then
  note "Sending is allowed."
else
  note "Sending isn't allowed yet. Turn on Messages for rymessage-server in"
  note "System Settings > Privacy & Security > Automation, then run: launchctl kickstart -k $DOMAIN/$LABEL"
fi

step "Staying available"
if fdesetup isactive >/dev/null 2>&1; then
  note "FileVault is on, so after a restart the Mac waits at the unlock screen and RyMessage"
  note "won't run until someone logs in. For planned restarts use: sudo fdesetup authrestart"
elif [[ -n "$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)" ]]; then
  note "Automatic login is on, so RyMessage comes back by itself after a restart or power cut."
else
  note "Turn on automatic login (System Settings > Users & Groups) so RyMessage comes back"
  note "by itself after a restart or power cut."
fi
SLEEP_MINUTES="$(pmset -g 2>/dev/null | awk '$1 == "sleep" { print $2 }')"
if [[ -n "$SLEEP_MINUTES" && "$SLEEP_MINUTES" != "0" ]]; then
  note "This Mac sleeps after $SLEEP_MINUTES minutes idle, which takes RyMessage offline."
  note "To keep it awake: sudo pmset -a sleep 0"
fi

step "Pair your PC"
note "Paste this into RyMessage on Windows:"
echo
echo "    $("$BINARY" --pairing-code)"
echo
note "Logs:    $LOG"
note "Update:  git pull, then ./install.sh again"
note "Remove:  ./uninstall.sh"
