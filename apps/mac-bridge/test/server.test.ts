import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { BridgeServer } from "../src/server.js";
import { ensureBridgeIdentity } from "../src/config/identity.js";
import type { BridgeConfig } from "../src/config/index.js";

function testConfig(root: string): BridgeConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    advertisedHost: null,
    allowedOrigins: [],
    allowedWorkspaces: [root],
    pairingTtlSeconds: 600,
    deviceName: "Test Mac",
    codexWsPort: 8788,
    bridgeStateDir: root,
    bridgePrivateKeyPath: path.join(root, "bridge.pem"),
    trustStorePath: path.join(root, "trusted-devices.json"),
    webDistDir: path.join(root, "web-dist"),
  };
}

class FakeCodexClient extends EventEmitter {
  resolvedRequests: Array<{ requestId: string; result: unknown }> = [];

  constructor(private readonly threads: Array<{
    id: string;
    preview: string;
    updatedAt: number;
    status: string;
    cwd: string;
    name: string;
    turns: [];
  }> = []) {
    super();
  }

  async start(): Promise<void> {}

  getRuntimeState(): "ready" {
    return "ready";
  }

  async listThreads() {
    return this.threads;
  }

  async readThread(threadId: string) {
    return {
      id: threadId,
      preview: "blocked",
      updatedAt: 1_710_000_000,
      status: "ready",
      cwd: "/opt/elsewhere",
      name: "Blocked",
      turns: [],
    };
  }

  async startThread(): Promise<never> {
    throw new Error("not implemented");
  }

  async sendMessage(): Promise<void> {}

  resolveServerRequest(requestId: string, result: unknown): void {
    this.resolvedRequests.push({ requestId, result });
  }
}

test("bridge server rejects thread access outside the configured workspaces", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-server-"));
  const config = testConfig(root);
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const bridge = new BridgeServer(config, identity, new FakeCodexClient() as never);
  const socketMessages: string[] = [];
  const client = {
    socket: {
      send: (message: string) => {
        socketMessages.push(message);
      },
    },
    authenticatedDeviceId: "device-1",
  } as const;

  await assert.rejects(async () => {
    await (bridge as unknown as { handleClientMessage: (client: unknown, raw: string) => Promise<void> }).handleClientMessage(
      client,
      JSON.stringify({
        type: "thread.send",
        requestId: "req-1",
        payload: {
          threadId: "thread-1",
          message: "hello",
        },
      }),
    );
  });

  assert.equal(socketMessages.length, 0);
});

test("bridge server filters thread list entries outside the configured workspaces", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-server-"));
  const config = testConfig(root);
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const bridge = new BridgeServer(
    config,
    identity,
    new FakeCodexClient([
      {
        id: "thread-allowed",
        preview: "allowed",
        updatedAt: 1_710_000_001,
        status: "ready",
        cwd: root,
        name: "Allowed",
        turns: [],
      },
      {
        id: "thread-blocked",
        preview: "blocked",
        updatedAt: 1_710_000_002,
        status: "ready",
        cwd: "/opt/elsewhere",
        name: "Blocked",
        turns: [],
      },
    ]) as never,
  );
  const socketMessages: string[] = [];
  const client = {
    socket: {
      send: (message: string) => {
        socketMessages.push(message);
      },
    },
    authenticatedDeviceId: "device-1",
  } as const;

  await (bridge as unknown as { handleClientMessage: (client: unknown, raw: string) => Promise<void> }).handleClientMessage(
    client,
    JSON.stringify({
      type: "thread.list",
      requestId: "req-1",
    }),
  );

  const reply = JSON.parse(socketMessages.at(-1) ?? "{}") as { type?: string; payload?: { threads?: Array<{ threadId: string }> } };
  assert.equal(reply.type, "thread.list");
  assert.equal(reply.payload?.threads?.length, 1);
  assert.equal(reply.payload?.threads?.[0]?.threadId, "thread-allowed");
});

test("bridge server exposes a health snapshot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-server-"));
  const config = testConfig(root);
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const bridge = new BridgeServer(config, identity, new FakeCodexClient() as never);
  const snapshot = bridge.getHealthSnapshot();

  assert.equal(snapshot.started, false);
  assert.equal(snapshot.runtimeState, "starting");
  assert.equal(snapshot.allowedWorkspaces, 1);
  assert.equal(snapshot.connectedClients, 0);
  assert.equal(snapshot.authenticatedClients, 0);
});

test("bridge server responds to health checks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-server-"));
  const config = testConfig(root);
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const bridge = new BridgeServer(config, identity, new FakeCodexClient() as never);
  const responseBody: string[] = [];
  const response = {
    writeHead(statusCode: number, headers: Record<string, string>) {
      assert.equal(statusCode, 200);
      assert.equal(headers["content-type"], "application/json");
      return response;
    },
    end(chunk?: string) {
      if (chunk) {
        responseBody.push(chunk);
      }
    },
  } as never;

  (bridge as unknown as { handleRequest: (request: { method?: string; url?: string }, response: typeof response) => void }).handleRequest(
    { method: "GET", url: "/healthz" },
    response,
  );

  const parsed = JSON.parse(responseBody.join("")) as { started: boolean; runtimeState: string };
  assert.equal(parsed.started, false);
  assert.equal(parsed.runtimeState, "starting");
});

test("bridge server returns 404 for unknown health routes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-server-"));
  const config = testConfig(root);
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const bridge = new BridgeServer(config, identity, new FakeCodexClient() as never);
  let statusCode = 0;
  const response = {
    writeHead(code: number) {
      statusCode = code;
      return response;
    },
    end() {},
  } as never;

  (bridge as unknown as { handleRequest: (request: { method?: string; url?: string }, response: typeof response) => void }).handleRequest(
    { method: "GET", url: "/not-healthz" },
    response,
  );

  assert.equal(statusCode, 404);
});

test("bridge server serves web assets with SPA fallback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-server-"));
  const webDist = path.join(root, "web-dist");
  fs.mkdirSync(webDist);
  fs.writeFileSync(path.join(webDist, "index.html"), "<!doctype html><div id=\"root\"></div>");
  fs.writeFileSync(path.join(webDist, "app.js"), "console.log('ready');");
  const config = { ...testConfig(root), webDistDir: webDist };
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const bridge = new BridgeServer(config, identity, new FakeCodexClient() as never);
  const responseBody: string[] = [];
  const response = {
    writeHead(statusCode: number, headers: Record<string, string>) {
      assert.equal(statusCode, 200);
      assert.equal(headers["content-type"], "text/html; charset=utf-8");
      return response;
    },
    end(chunk?: string) {
      if (chunk) {
        responseBody.push(chunk);
      }
    },
  } as never;

  (bridge as unknown as { handleRequest: (request: { method?: string; url?: string }, response: typeof response) => void }).handleRequest(
    { method: "GET", url: "/threads/thread-1" },
    response,
  );

  assert.match(responseBody.join(""), /root/);
});

test("bridge server captures, lists, broadcasts, and resolves approval requests", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-server-"));
  const config = testConfig(root);
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const codexClient = new FakeCodexClient();
  const bridge = new BridgeServer(config, identity, codexClient as never);
  const socketMessages: string[] = [];
  const client = {
    socket: {
      send: (message: string) => {
        socketMessages.push(message);
      },
    },
    authenticatedDeviceId: "device-1",
  } as const;
  (bridge as unknown as { clients: Set<unknown> }).clients.add(client);

  (bridge as unknown as { handleCodexServerRequest: (request: unknown) => void }).handleCodexServerRequest({
    jsonrpc: "2.0",
    id: "rpc-approval-1",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      command: "npm test",
      availableDecisions: ["accept", "decline"],
    },
  });

  const requested = JSON.parse(socketMessages.at(-1) ?? "{}") as {
    type?: string;
    payload?: { approval?: { approvalId: string; summary: string; choices: string[] } };
  };
  assert.equal(requested.type, "approval.requested");
  assert.equal(requested.payload?.approval?.summary, "npm test");
  assert.deepEqual(requested.payload?.approval?.choices, ["accept", "decline"]);

  await (bridge as unknown as { handleClientMessage: (client: unknown, raw: string) => Promise<void> }).handleClientMessage(
    client,
    JSON.stringify({
      type: "approval.list",
      requestId: "req-list",
    }),
  );
  const listReply = JSON.parse(socketMessages.at(-1) ?? "{}") as { payload?: { approvals?: Array<{ approvalId: string }> } };
  const approvalId = listReply.payload?.approvals?.[0]?.approvalId;
  assert.ok(approvalId);

  await (bridge as unknown as { handleClientMessage: (client: unknown, raw: string) => Promise<void> }).handleClientMessage(
    client,
    JSON.stringify({
      type: "approval.resolve",
      requestId: "req-resolve",
      payload: {
        approvalId,
        result: { decision: "accept" },
      },
    }),
  );

  assert.deepEqual(codexClient.resolvedRequests, [
    {
      requestId: "rpc-approval-1",
      result: { decision: "accept" },
    },
  ]);
  const resolveReply = JSON.parse(socketMessages.at(-1) ?? "{}") as { type?: string; payload?: { approvalId?: string } };
  assert.equal(resolveReply.type, "approval.resolve");
  assert.equal(resolveReply.payload?.approvalId, approvalId);
});
