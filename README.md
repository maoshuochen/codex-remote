# Codex Remote MVP

`Codex Remote` is a local-first MVP for controlling Codex running on a Mac from an Android device over a trusted LAN or Tailscale connection.

## What is included

- `apps/mac-bridge`: macOS bridge written in TypeScript
- `apps/android`: Android client scaffold with Compose UI, pairing, thread list, and chat screen structure
- `packages/protocol`: shared bridge protocol schema and types

## MVP boundaries

- Remote control the Codex runtime, not the desktop UI
- Open a thread in `Codex.app` using `codex://threads/<threadId>`
- Pair a trusted Android device using a one-time QR token
- Stream agent output to the phone over WebSocket
- Restrict writable workspaces to a configured allowlist

## Quick start

### 1. Install dependencies

```sh
npm install
```

### 2. Configure the bridge

```sh
cp .env.example .env
```

Set `CODEX_REMOTE_ALLOWED_WORKSPACES` to one or more absolute directories separated by commas.

### 3. Run the bridge

```sh
npm run dev:bridge
```

The bridge will:

- start `codex app-server` on a loopback WebSocket
- print a QR payload in the terminal
- accept Android client pairing and reconnects

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

Key event types:

- `pair.confirm`
- `auth.challenge`
- `thread.stream.delta`
- `thread.stream.done`
- `thread.stream.error`
- `runtime.status`

## Android project

The Android app is scaffolded as a standalone Gradle project under `apps/android`. This machine does not currently have a Java runtime or Android SDK, so the Android code was created and aligned to the protocol, but not compiled locally.

## Verification completed

- `codex-cli 0.120.0` is available locally
- `codex app-server --help` confirms WebSocket transport support
- TypeScript workspace builds and bridge tests are expected to run after `npm install`
