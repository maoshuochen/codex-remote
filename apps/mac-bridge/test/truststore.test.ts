import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TrustStore } from "../src/pairing/store.js";

test("trust store persists and clears trusted devices", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-truststore-"));
  const store = new TrustStore(path.join(root, "trusted-devices.json"));

  store.put({
    deviceId: "device-1",
    deviceName: "Pixel",
    publicKey: "public-key",
    pairedAt: "2026-04-12T00:00:00Z",
  });

  assert.equal(store.list().length, 1);
  assert.equal(store.get("device-1")?.deviceName, "Pixel");
  const raw = JSON.parse(fs.readFileSync(path.join(root, "trusted-devices.json"), "utf8")) as {
    devices: Array<{ deviceId: string }>;
  };
  assert.equal(raw.devices[0]?.deviceId, "device-1");

  store.clear();

  assert.deepEqual(store.list(), []);
  const cleared = JSON.parse(fs.readFileSync(path.join(root, "trusted-devices.json"), "utf8")) as {
    devices: Array<{ deviceId: string }>;
  };
  assert.deepEqual(cleared.devices, []);
});

test("trust store replaces existing devices by id", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-truststore-"));
  const store = new TrustStore(path.join(root, "trusted-devices.json"));

  store.put({
    deviceId: "device-1",
    deviceName: "Pixel",
    publicKey: "public-key-1",
    pairedAt: "2026-04-12T00:00:00Z",
  });
  store.put({
    deviceId: "device-1",
    deviceName: "Pixel 2",
    publicKey: "public-key-2",
    pairedAt: "2026-04-12T00:01:00Z",
  });

  assert.equal(store.list().length, 1);
  assert.equal(store.get("device-1")?.publicKey, "public-key-2");
});

test("trust store falls back to empty data for malformed files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-truststore-"));
  const filePath = path.join(root, "trusted-devices.json");
  fs.writeFileSync(filePath, "{not json}", "utf8");

  const store = new TrustStore(filePath);

  assert.deepEqual(store.list(), []);
  assert.equal(store.get("device-1"), undefined);
});
