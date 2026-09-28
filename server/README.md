# RyMessage Server

The macOS companion server. Normalizes Messages.app data into the RyMessage API defined in `../docs/api.md` and pushes real-time events to connected clients.

Runs natively on macOS 13 or later. It can't run in Docker: it needs your Mac's Messages database, Messages.app, and macOS privacy permissions, none of which reach inside a container.

## Install

On the Mac, logged in as the account that uses Messages:

```
git clone https://github.com/ryanpolasky/RyMessage.git
cd RyMessage/server
./install.sh
```

The script:

1. Installs Apple's command line tools if they're missing, offers to update them if their Swift is older than 6, then builds the server.
2. Installs it to `~/Library/Application Support/RyMessage/` and registers a LaunchAgent, so it starts whenever you log in and restarts itself if it ever quits. If port 8787 is taken, it moves to the next free port.
3. Offers to put your Tailscale address in the pairing code, if Tailscale is installed.
4. Walks you through the one-time **Full Disk Access** permission. It opens the right System Settings page and a Finder window with the server selected, so you just drag it in.
5. Watches for the one-time **Automation** prompt ("rymessage-server wants to control Messages"). Click OK.
6. Checks what could stop it after a reboot: FileVault, automatic login, and sleep.
7. Prints the pairing code to paste into RyMessage on Windows.

Everything can be done over Screen Sharing.

**Updating:** `git pull`, then `./install.sh` again. The script signs the server with a local certificate it creates in your login keychain ("RyMessage Local Signing"), so macOS keeps Full Disk Access and Automation across updates. If signing ever fails, the script asks for the permissions again.

**Removing:** `./uninstall.sh`.

**Logs:** `~/Library/Logs/RyMessage/server.log`.

**Print the pairing code again:** `~/Library/Application\ Support/RyMessage/rymessage-server --pairing-code`

**Restart:** `launchctl kickstart -k gui/$(id -u)/app.rymessage.server`

## Staying up after reboots

The server runs inside your login session, because Messages.app does. After a restart it comes back as soon as the account logs in:

* **Automatic login** (System Settings > Users & Groups) brings it back by itself after a restart or power cut. It isn't available while FileVault is on.
* **With FileVault on,** the Mac waits at the unlock screen after a restart. For planned restarts, `sudo fdesetup authrestart` skips that prompt once.
* **Sleep** takes it offline. `sudo pmset -a sleep 0` keeps the Mac awake.

## Development

```
swift run
```

A server started from Terminal borrows Terminal's permissions, so Terminal needs Full Disk Access for it to read messages.

On first run the server generates a random token, stores it in `~/.rymessage/config.json` (permissions 600), and prints a pairing code. Every endpoint requires the token as a bearer token. `RYMESSAGE_TOKEN` overrides the stored token if set.

## Configuration

`~/.rymessage/config.json`:

| Key | Default | Description |
| --- | --- | --- |
| `token` | generated | Bearer token clients must present. |
| `port` | `8787` | Listening port. |
| `advertisedHost` | auto-detected LAN IP | Host embedded in the pairing code. Set this when clients connect over Tailscale or another tunnel. |
| `advertisedURL` | none | Full URL for the pairing code, overriding host and port. Required when a TLS front sits ahead of the server. |
| `allowedOrigins` | all origins | Restrict CORS to specific browser origins, e.g. `["https://message.example.com"]`. |

## HTTPS via Tailscale

Browsers block calls from an https page to a plain-http server, so hosted clients need the Mac reachable over HTTPS. Tailscale does this cleanly and without public exposure:

```
tailscale serve --bg 8787
```

That proxies `https://<mac-name>.<tailnet>.ts.net` to the server with valid certificates, reachable only from your tailnet. Then point pairing codes at it:

```
~/Library/Application\ Support/RyMessage/rymessage-server --set-advertised-url https://<mac-name>.<tailnet>.ts.net
```

## HTTPS via Cloudflare Tunnel

An existing cloudflared tunnel can front the server instead. This makes the endpoint publicly reachable, so the bearer token becomes the entire security boundary; keep it secret and rotate it if leaked.

Add an ingress rule to the tunnel config:

```yaml
ingress:
  - hostname: rymessage-api.example.com
    service: http://<mac-lan-ip>:8787
```

If cloudflared runs in Docker on the Mac itself, use `http://host.docker.internal:8787`. Route the hostname to the tunnel (`cloudflared tunnel route dns <tunnel> rymessage-api.example.com` or via the dashboard), then set:

```json
{
  "advertisedURL": "https://rymessage-api.example.com",
  "allowedOrigins": ["https://<your-client-domain>"]
}
```

`allowedOrigins` is strongly recommended for public exposure. WebSockets authenticate in-band with their first message, so tokens never appear in URLs or proxy logs.

## Pairing code format

`RYM1.` followed by base64url JSON: `{"t":"<token>","u":"<server url>"}`.

## What works

| Feature | How |
| --- | --- |
| Conversations, messages, received tapbacks and replies | Read from `~/Library/Messages/chat.db`. A contact's separate iMessage and SMS chats are merged into one conversation, and sends go to whichever was used most recently |
| Live updates | chat.db is checked every second for new messages, tapbacks, and delivery or read changes |
| Photos, videos, voice messages, files | Served from `~/Library/Messages/Attachments`. HEIC photos become JPEG, `.mov` videos become H.264 MP4, and `.caf` voice messages become M4A, cached in `~/Library/Caches/RyMessage` |
| Sending text and files, starting one-on-one chats | AppleScript automation of Messages.app. Files are staged in `~/Pictures/RyMessage` first, because Messages only picks up files from your home folders |
| Contact names and photos | Read from the Contacts database, which Full Disk Access already covers |

Sending tapbacks and replies, typing indicators, marking read on the Mac, and starting new group chats all need Apple's private API. The server reports them as unsupported, so the client hides them.

## Security

* Never expose this server publicly. Prefer a Tailscale or other private tunnel between the Mac and the Windows client.
* Message contents are not logged.
