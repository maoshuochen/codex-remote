# Codex Remote MVP

`Codex Remote` is a local-first companion for controlling Codex running on a Mac from an Android device over a trusted LAN or Tailscale connection.

## Product perspective

This is a phone companion for Codex on macOS, not a general remote desktop app.

### Product positioning

- A phone-first way to check status, open threads, and send follow-ups.
- A simple bridge between one trusted Android device and one trusted Mac runtime.
- A narrow remote workflow for chat, thread review, and handoff back to `Codex.app`.

### Primary users

- Developers who want to keep using Codex while away from their Mac.
- People who want to start, continue, or triage chats from their phone.
- Early adopters who are comfortable with a local trust model.

### Core user jobs

- Check bridge and runtime status.
- Create a new chat.
- Review existing threads.
- Send a follow-up message.
- Open a thread in `Codex.app` when needed.

### Product value

- Cuts down context switching.
- Keeps control local and explicit.
- Preserves workspace boundaries.
- Makes Codex useful when the laptop is not nearby.

### Product principles

- The Mac stays in charge.
- Pairing is intentional and one-time.
- The app controls Codex sessions, not the full desktop.
- Writable access stays limited to allowed workspaces.

### Typical flow

1. Start the bridge on the Mac and wait for it to be ready.
2. Scan the one-time QR code from the Android app to pair the device.
3. Open the home screen to view status and chats.
4. Create a new chat or open an existing thread.
5. Send a follow-up message or hand off to `Codex.app`.

### Non-goals

- Replacing the Mac UI with a full remote desktop.
- Exposing Codex to untrusted networks or anonymous devices.
- Acting as a screen-mirroring, file-sync, or device-management app.
- Removing the need for a trusted Mac runtime.

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

## Trust model

- The bridge assumes the LAN or Tailscale link is already trusted.
- The Android device is trusted only after QR pairing and challenge verification.
- The bridge only accepts threads rooted inside configured workspaces.
- The Android device keeps its pairing secret in Android Keystore-backed storage.

## Failure recovery

- If the bridge reports startup or runtime errors, restart `codex app-server` and re-pair if the trust store was cleared.
- If the phone shows stale thread data, refresh the thread list or reconnect the device.
- If a pairing token expires, generate a new QR payload from the bridge terminal.

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

The Android app is scaffolded as a standalone Gradle project under `apps/android`. It uses Java 17 and the Android SDK, and the local unit tests can be run with `cd apps/android && ./gradlew test`.

## Testing notes

- `npm test` covers the mac bridge config, pairing, session indexing, and bridge access control checks.
- `npm run build` compiles the TypeScript workspace.
- `npm run verify` runs the test suite followed by a workspace build.
- `npm run verify:android` runs the Android unit tests.
- `npm run verify:all` runs both the workspace verification and the Android unit tests.
- GitHub Actions runs `npm run verify` on push and pull request.
- GitHub Actions also runs `cd apps/android && ./gradlew test` for Android unit tests.
- `GET /healthz` on the bridge reports the current runtime snapshot for quick checks.
- Android Gradle verification requires Java 17 and an installed Android SDK.

## Verification completed

- `codex-cli 0.120.0` is available locally
- `codex app-server --help` confirms WebSocket transport support
- TypeScript workspace builds and bridge tests are expected to run after `npm install`
