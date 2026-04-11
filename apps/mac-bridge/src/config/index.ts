import { config as loadEnv } from "dotenv";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

loadEnv();

export type BridgeConfig = {
  host: string;
  port: number;
  allowedWorkspaces: string[];
  pairingTtlSeconds: number;
  deviceName: string;
  codexWsPort: number;
  bridgeStateDir: string;
  bridgePrivateKeyPath: string;
  trustStorePath: string;
};

export function loadConfig(): BridgeConfig {
  const bridgeStateDir = path.join(os.homedir(), ".codex-remote");
  return {
    host: process.env.CODEX_REMOTE_HOST ?? "0.0.0.0",
    port: Number.parseInt(process.env.CODEX_REMOTE_PORT ?? "8787", 10),
    allowedWorkspaces: (process.env.CODEX_REMOTE_ALLOWED_WORKSPACES ?? process.cwd())
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    pairingTtlSeconds: Number.parseInt(process.env.CODEX_REMOTE_PAIRING_TTL_SECONDS ?? "600", 10),
    deviceName: process.env.CODEX_REMOTE_DEVICE_NAME ?? os.hostname(),
    codexWsPort: Number.parseInt(process.env.CODEX_REMOTE_CODEX_WS_PORT ?? "8788", 10),
    bridgeStateDir,
    bridgePrivateKeyPath: path.join(bridgeStateDir, "bridge-ed25519.pem"),
    trustStorePath: path.join(bridgeStateDir, "trusted-devices.json"),
  };
}

export function createPairingToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}
