#!/bin/bash
set -euo pipefail

LABEL="app.rymessage.server"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/RyMessage" "$HOME/Library/Caches/RyMessage"

echo "RyMessage Server is stopped and removed."
echo "Your pairing token is kept in ~/.rymessage. Delete that folder to unpair every device."
echo "You can also remove rymessage-server from System Settings > Privacy & Security > Full Disk Access."
