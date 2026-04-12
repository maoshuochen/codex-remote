import { config as loadEnv } from "dotenv";
import fs from "node:fs";
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
  const allowedWorkspaces = resolveAllowedWorkspaces(process.env.CODEX_REMOTE_ALLOWED_WORKSPACES ?? process.cwd());
  return {
    host: process.env.CODEX_REMOTE_HOST ?? "0.0.0.0",
    port: parsePositiveInt(process.env.CODEX_REMOTE_PORT ?? "8787", "CODEX_REMOTE_PORT"),
    allowedWorkspaces,
    pairingTtlSeconds: parsePositiveInt(
      process.env.CODEX_REMOTE_PAIRING_TTL_SECONDS ?? "600",
      "CODEX_REMOTE_PAIRING_TTL_SECONDS",
    ),
    deviceName: process.env.CODEX_REMOTE_DEVICE_NAME ?? os.hostname(),
    codexWsPort: parsePositiveInt(process.env.CODEX_REMOTE_CODEX_WS_PORT ?? "8788", "CODEX_REMOTE_CODEX_WS_PORT"),
    bridgeStateDir,
    bridgePrivateKeyPath: path.join(bridgeStateDir, "bridge-ed25519.pem"),
    trustStorePath: path.join(bridgeStateDir, "trusted-devices.json"),
  };
}

export function createPairingToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function resolveAllowedWorkspaces(rawValue: string): string[] {
  const roots = rawValue
    .split(",")
    .map((value) => path.resolve(value.trim()))
    .filter(Boolean);

  const unique = new Set<string>();
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      throw new Error(`Workspace path does not exist: ${root}`);
    }
    if (!fs.statSync(root).isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${root}`);
    }
    unique.add(root);
  }

  if (unique.size === 0) {
    throw new Error("At least one allowed workspace must be configured.");
  }

  return [...unique];
}

export function parsePositiveInt(rawValue: string, name: string): number {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
