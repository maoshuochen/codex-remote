import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ensureBridgeIdentity } from "../src/config/identity.js";
import { PairingService } from "../src/pairing/service.js";
import type { BridgeConfig } from "../src/config/index.js";

function testConfig(root: string): BridgeConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    allowedWorkspaces: [root],
    pairingTtlSeconds: 600,
    deviceName: "Test Mac",
    codexWsPort: 8788,
    bridgeStateDir: root,
    bridgePrivateKeyPath: path.join(root, "bridge.pem"),
    trustStorePath: path.join(root, "trusted-devices.json"),
  };
}

test("pairing service accepts valid token and verifies challenge", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-pairing-"));
  const config = testConfig(root);
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const service = new PairingService(config, identity);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const qr = service.issuePairingQr("ws://127.0.0.1:8787", "pair-token");

  const confirm = service.acceptPairRequest({
    pairingToken: qr.pairingToken,
    deviceId: "device-1",
    deviceName: "Pixel",
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  });

  assert.equal(confirm.trusted, true);
  const challenge = service.createChallenge();
  const signature = crypto.sign(null, Buffer.from(challenge.nonce), privateKey).toString("base64");

  assert.equal(service.verifyChallengeResponse("device-1", challenge.challengeId, signature), true);
});

test("pairing service rejects expired tokens", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-pairing-"));
  const config = testConfig(root);
  config.pairingTtlSeconds = -1;
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const service = new PairingService(config, identity);
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const qr = service.issuePairingQr("ws://127.0.0.1:8787", "pair-token");

  assert.throws(() =>
    service.acceptPairRequest({
      pairingToken: qr.pairingToken,
      deviceId: "device-1",
      deviceName: "Pixel",
      publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
    }),
  );
});
