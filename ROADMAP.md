# Codex Remote Roadmap

`Codex Remote` should stay a focused, local-first web companion for Codex on a trusted Mac. The Mac remains the execution host; the browser is the lightweight control surface for status, review, approvals, and follow-up messages.

## Product Boundaries

- Keep pairing explicit with token-based trust establishment.
- Keep writable access limited to configured workspace roots.
- Prefer Tailscale or trusted LAN access over public exposure.
- Avoid remote desktop, screen scraping, file sync, and multi-user collaboration scope.

## Phase 1: Web Control Surface

- Improve the approval center for Codex command, file-change, permission, and structured-input requests.
- Add turn controls for interrupting and steering active work.
- Improve session detail from a simple chat transcript into a timeline with status, plan, diff, command output, and errors.
- Add PWA metadata for installable mobile and tablet use.
- Keep the bridge protocol typed and versionable as these surfaces grow.

## Phase 2: Operator Experience

- Add bridge device management: list trusted browsers, revoke trust, rename devices, and show last-seen metadata.
- Add a bridge status console for runtime state, pairing refresh, allowed workspaces, trusted-device management, and origin diagnostics.
- Add doctor commands for `codex` availability, `codex app-server`, port checks, workspace checks, web dist checks, and Tailscale address hints.
- Document the recommended Tailscale setup without making nginx a default dependency.

## Phase 3: Platform Reach

- Harden browser key storage and document browser compatibility expectations.
- Consider a Go bridge or agent only if Windows/Linux host support becomes a near-term goal.
- Defer relay, push notifications, and hosted access until local/Tailscale workflows are solid and auditable.

## Near-Term Checklist

- Keep generated web artifacts out of git.
- Maintain protocol tests for every new bridge message.
- Add bridge tests for static web serving, origin checks, approval capture, listing, and resolution.
- Add web coverage around pairing, reconnect, request/reply handling, approval decode, and stream deltas.
