import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadEnv();

export type BridgeConfig = {
  host: string;
  port: number;
  advertisedHost: string | null;
  allowedOrigins: string[];
  allowedWorkspaces: string[];
  pairingTtlSeconds: number;
  deviceName: string;
  codexWsPort: number;
  bridgeStateDir: string;
  bridgePrivateKeyPath: string;
  trustStorePath: string;
  webDistDir: string;
};

export function loadConfig(): BridgeConfig {
  const bridgeStateDir = path.join(os.homedir(), ".codex-remote");
  const allowedWorkspaces = resolveAllowedWorkspaces(process.env.CODEX_REMOTE_ALLOWED_WORKSPACES ?? process.cwd());
  return {
    host: process.env.CODEX_REMOTE_HOST ?? "0.0.0.0",
    port: parsePositiveInt(process.env.CODEX_REMOTE_PORT ?? "8787", "CODEX_REMOTE_PORT"),
    advertisedHost: process.env.CODEX_REMOTE_ADVERTISED_HOST?.trim() || null,
    allowedOrigins: parseCsv(process.env.CODEX_REMOTE_ALLOWED_ORIGINS ?? ""),
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
    webDistDir: path.resolve(process.env.CODEX_REMOTE_WEB_DIST_DIR ?? defaultWebDistDir()),
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
    for (const expandedRoot of expandWorkspaceRoots(root)) {
      unique.add(expandedRoot);
    }
  }

  if (unique.size === 0) {
    throw new Error("At least one allowed workspace must be configured.");
  }

  return [...unique];
}

function expandWorkspaceRoots(root: string): string[] {
  if (!fs.existsSync(root)) {
    throw new Error(`Workspace path does not exist: ${root}`);
  }
  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${root}`);
  }

  if (fs.existsSync(path.join(root, ".git"))) {
    return [root];
  }

  const childRepos = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((childRoot) => fs.existsSync(path.join(childRoot, ".git")));

  if (childRepos.length > 0) {
    return childRepos;
  }

  return [root];
}

export function parsePositiveInt(rawValue: string, name: string): number {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function parseCsv(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function defaultWebDistDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/dist");
}
