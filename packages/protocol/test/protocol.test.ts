import test from "node:test";
import assert from "node:assert/strict";
import {
  pairingQrPayloadSchema,
  runtimeStateSchema,
  threadSummarySchema,
  threadDetailSchema,
} from "../src/protocol.js";

test("runtime state schema accepts known states", () => {
  assert.equal(runtimeStateSchema.parse("starting"), "starting");
  assert.equal(runtimeStateSchema.parse("ready"), "ready");
  assert.equal(runtimeStateSchema.parse("busy"), "busy");
  assert.equal(runtimeStateSchema.parse("error"), "error");
});

test("runtime state schema rejects unknown states", () => {
  assert.throws(() => runtimeStateSchema.parse("offline"));
});

test("pairing qr payload schema requires a valid url and token fields", () => {
  const payload = pairingQrPayloadSchema.parse({
    bridgeUrl: "ws://127.0.0.1:8787",
    deviceName: "Test Mac",
    pairingToken: "token",
    expiresAt: "2026-04-12T00:00:00Z",
    bridgePublicKeyFingerprint: "fingerprint",
  });

  assert.equal(payload.deviceName, "Test Mac");
});

test("thread summary schema supplies an empty preview default", () => {
  const summary = threadSummarySchema.parse({
    threadId: "thread-1",
    title: "Hello",
    updatedAt: "2026-04-12T00:00:00Z",
    workspaceId: "workspace-1",
    status: "idle",
  });

  assert.equal(summary.lastMessagePreview, "");
});

test("thread summary schema rejects missing required fields", () => {
  assert.throws(() =>
    threadSummarySchema.parse({
      threadId: "thread-1",
      title: "Hello",
      workspaceId: "workspace-1",
      status: "idle",
      updatedAt: "not-a-datetime",
    }),
  );
});

test("thread detail schema validates nested messages", () => {
  const detail = threadDetailSchema.parse({
    threadId: "thread-1",
    title: "Hello",
    workspaceId: "workspace-1",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        text: "Hi there",
      },
    ],
    status: "idle",
  });

  assert.equal(detail.messages[0]?.role, "assistant");
});
