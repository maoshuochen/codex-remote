# Codex Remote MVP

`Codex Remote` is a local-first web control surface for Codex running on a trusted Mac over LAN or Tailscale.

## Product perspective

This is a browser/PWA companion for Codex on macOS, not a general remote desktop app.

### Product positioning

- A lightweight way to check status, open threads, resolve approvals, and send follow-ups from any trusted browser.
- A simple bridge between trusted web clients and one trusted Mac runtime.
- A narrow remote workflow for chat, thread review, approvals, and handoff back to `Codex.app`.

### Core user jobs

- Check bridge and runtime status.
- Create a new chat.
- Review existing threads.
- Send a follow-up message.
- Resolve Codex approval requests.
- Open a thread in `Codex.app` when needed.

### Product principles

- The Mac stays in charge.
- Pairing is intentional and one-time.
- The browser controls Codex sessions, not the full desktop.
- Writable access stays limited to allowed workspaces.

### Typical flow

1. Start the bridge on the Mac and wait for it to be ready.
2. Open the printed web URL from a trusted browser.
3. Paste the one-time pairing token or the full pairing payload.
4. View threads, create chats, send follow-ups, and resolve approvals.
5. Hand off to `Codex.app` when the desktop experience is needed.

### Non-goals

- Replacing the Mac UI with a full remote desktop.
- Exposing Codex to untrusted networks or anonymous devices.
- Acting as a screen-mirroring, file-sync, or device-management app.
- Removing the need for a trusted Mac runtime.

## What is included

- `apps/mac-bridge`: macOS bridge written in TypeScript
- `apps/web`: React/Vite web client served by the bridge or run standalone during development
- `packages/protocol`: shared bridge protocol schema and types

## MVP boundaries

- Remote control the Codex runtime, not the desktop UI
- Open a thread in `Codex.app` using `codex://threads/<threadId>`
- Pair a trusted browser using a one-time token
- Stream agent output to the browser over WebSocket
- Restrict writable workspaces to a configured allowlist

## Trust model

- The bridge assumes the LAN or Tailscale link is already trusted.
- A browser is trusted only after pairing and challenge verification.
- The bridge only accepts threads rooted inside configured workspaces.
- The browser stores its pairing key locally for reconnects.
- WebSocket origins are limited to localhost, the advertised bridge host, and optional configured origins.

## Quick start

### 1. Install dependencies

```sh
npm install
```

### 2. Configure the bridge

```sh
cp .env.example .env
```

Set `CODEX_REMOTE_ALLOWED_WORKSPACES` to one or more absolute directories separated by commas. If you point it at a parent code directory, the bridge will expand immediate git repositories under it into separate workspaces.

Useful web settings:

- `CODEX_REMOTE_ADVERTISED_HOST`: override the host printed in pairing URLs.
- `CODEX_REMOTE_ALLOWED_ORIGINS`: comma-separated browser origins that may open WebSocket connections.
- `CODEX_REMOTE_WEB_DIST_DIR`: directory containing the built web client.

### 3. Build the web client

```sh
npm run build:web
```

### 4. Run the bridge

```sh
npm run dev:bridge
```

The bridge will:

- start `codex app-server` on a loopback WebSocket
- serve the web client from `apps/web/dist`
- print a pairing payload in the terminal
- accept paired browser reconnects

For web UI development without rebuilding the bridge-served bundle:

```sh
npm run dev:web
```

## Bridge protocol

The bridge protocol lives in [`packages/protocol/src/protocol.ts`](/Users/maoshuo/code/codex-remote/packages/protocol/src/protocol.ts).

Key request types:

- `pair.request`
- `auth.response`
- `workspace.list`
- `thread.list`
- `thread.create`
- `thread.get`
- `thread.send`
- `thread.open_in_codex_app`
- `approval.list`
- `approval.resolve`

Key event types:

- `pair.confirm`
- `auth.challenge`
- `approval.requested`
- `approval.resolved`
- `thread.stream.delta`
- `thread.stream.done`
- `thread.stream.error`
- `runtime.status`

## Testing notes

- `npm test` covers protocol, bridge config, pairing, session indexing, approvals, and bridge access control checks.
- `npm run build` compiles all TypeScript workspaces and builds the web client.
- `npm run verify` runs the test suite followed by a workspace build.
- `npm run verify:web` type-checks and builds the web client.
- GitHub Actions runs `npm run verify` on push and pull request.
- `GET /healthz` on the bridge reports the current runtime snapshot for quick checks.

## Verification completed

- `codex app-server --help` confirms WebSocket transport support.
- TypeScript workspace builds and bridge tests are expected to run after `npm install`.
