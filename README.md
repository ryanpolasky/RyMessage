# RyMessage

A Windows iMessage client backed by a companion server running on macOS. The Mac remains the actual iMessage endpoint; the Windows app acts as a native remote client for reading, sending, and managing conversations.

## Structure

- `client/` - Windows client. Vite + React + TypeScript, wrapped in Tauri 2 for the native shell.
- `server/` - macOS companion server. Swift + Vapor. Reads chat.db, drives Messages.app, exposes the RyMessage API.
- `docs/` - Shared documentation including the API contract.

## Setup

1. On the Mac, run `server/install.sh`. It builds the server, sets it to start at login, walks you through the two macOS permissions, and prints a pairing code. See `server/README.md`.
2. On Windows, open RyMessage and paste the pairing code. That's it.

Prefer a private network between the two machines, such as Tailscale. If the server advertises the wrong address for pairing, set `advertisedHost` in `~/.rymessage/config.json`.

## Development

### Client

```
cd client
npm install
npm run dev
```

The app opens with the pairing screen. Click "Try the demo" to use built-in fake conversations so UI work is not blocked by the Mac. The choice is stored locally; use the sidebar footer to exit.

### Desktop app

Requires Rust (MSVC toolchain) and the Visual Studio C++ Build Tools with a Windows SDK.

```
cd client
npm run tauri dev
```

Incoming texts appear as floating message bubbles in the top-left corner of the screen, even while the main window is closed to the tray. Clicking a bubble opens that conversation. Open `/overlay.html` on the plain dev server to iterate on the overlay design in a browser.

### Server

The server builds and runs on macOS only.

```
cd server
swift run
```

## Hosted client (Cloudflare Pages)

The client deploys as a static site so pushes to `main` redeploy automatically. Cloudflare Pages settings:

- Root directory: `client`
- Build command: `npm run build`
- Build output directory: `dist`

The hosted page talks directly to the Mac server from the browser; nothing message-related touches the host. Because the page is served over https, the Mac server must also be reachable over https. See `server/README.md` for the `tailscale serve` setup.
