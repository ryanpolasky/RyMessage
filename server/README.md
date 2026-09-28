# RyMessage Server

The macOS companion server. Normalizes Messages.app data into the RyMessage API defined in `../docs/api.md` and pushes real-time events to connected clients.

Builds and runs on macOS only.

## Running

```
swift run
```

On first run the server generates a random token, stores it in `~/.rymessage/config.json` (permissions 600), and prints a pairing code. Paste the pairing code into the RyMessage app on Windows to connect.

Every endpoint requires the token as a bearer token. `RYMESSAGE_TOKEN` overrides the stored token if set.

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

That proxies `https://<mac-name>.<tailnet>.ts.net` to the server with valid certificates, reachable only from your tailnet. Then set:

```json
{ "advertisedURL": "https://<mac-name>.<tailnet>.ts.net" }
```

and restart so pairing codes hand out the https address.

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

## Status

The HTTP and WebSocket surface is in place. All capabilities currently report `false` and their endpoints return `501 not_supported` until the chat.db reader and Messages.app send path are implemented.

Planned implementation order:

1. Read conversations and messages from `~/Library/Messages/chat.db` (requires Full Disk Access).
2. Poll or watch chat.db for new messages and broadcast events.
3. Send text via AppleScript automation of Messages.app.
4. Serve attachments from `~/Library/Messages/Attachments`.
5. Send attachments.

## Security

* Never expose this server publicly. Prefer a Tailscale or other private tunnel between the Mac and the Windows client.
* Message contents are not logged.
