import crypto from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import {
  authResponsePayloadSchema,
  bridgeMessageSchema,
  errorPayloadSchema,
  pairRequestPayloadSchema,
  runtimeStatusPayloadSchema,
  threadCreatePayloadSchema,
  threadGetPayloadSchema,
  threadOpenPayloadSchema,
  threadSendPayloadSchema,
  threadStreamDeltaPayloadSchema,
  threadStreamDonePayloadSchema,
  threadStreamErrorPayloadSchema,
  workspaceListResponsePayloadSchema,
  type BridgeMessage,
  type RuntimeStatusPayload,
  type ThreadSummary,
} from "@codex-remote/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import type { BridgeConfig } from "./config/index.js";
import { createPairingToken } from "./config/index.js";
import type { BridgeIdentity } from "./config/identity.js";
import { openThreadInDesktopApp } from "./desktop/openThread.js";
import { log } from "./logger.js";
import { PairingService } from "./pairing/service.js";
import { SessionIndex } from "./sessions/index.js";
import { CodexAppServerClient } from "./appserver/client.js";

type ClientState = {
  socket: WebSocket;
  authenticatedDeviceId: string | null;
};

export class BridgeServer {
  private readonly httpServer = createServer();
  private readonly wsServer = new WebSocketServer({ server: this.httpServer });
  private readonly clients = new Set<ClientState>();
  private readonly pairingService: PairingService;
  private readonly sessionIndex = new SessionIndex();

  constructor(
    private readonly config: BridgeConfig,
    private readonly identity: BridgeIdentity,
    private readonly codexClient: CodexAppServerClient,
  ) {
    this.pairingService = new PairingService(config, identity);
  }

  async start(): Promise<void> {
    this.codexClient.on("runtimeState", (state) => {
      this.broadcast("runtime.status", { state } satisfies RuntimeStatusPayload);
    });
    this.codexClient.on("notification", (notification) => this.handleCodexNotification(notification));
    this.codexClient.on("stderr", (stderr) => log("warn", "codex app-server stderr", { stderr }));

    this.wsServer.on("connection", (socket) => {
      const client: ClientState = { socket, authenticatedDeviceId: null };
      this.clients.add(client);
      log("info", "client connected");

      const challenge = this.pairingService.createChallenge();
      this.send(socket, { type: "auth.challenge", payload: challenge });
      this.send(socket, {
        type: "runtime.status",
        payload: { state: this.codexClient.getRuntimeState() },
      });

      socket.on("message", async (data) => {
        try {
          await this.handleClientMessage(client, data.toString());
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown bridge error";
          log("error", "client message failed", { message });
          this.send(socket, {
            type: "error",
            payload: errorPayloadSchema.parse({
              code: "bridge_error",
              message,
            }),
          });
        }
      });

      socket.on("close", () => {
        this.clients.delete(client);
        log("info", "client disconnected");
      });
    });

    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => resolve());
    });

    const bridgeUrl = `ws://${resolveAdvertisedHost(this.config.host)}:${this.config.port}`;
    const pairingPayload = this.pairingService.issuePairingQr(bridgeUrl, createPairingToken());
    log("info", "bridge server listening", {
      host: this.config.host,
      port: this.config.port,
      pairingPayload,
    });

    const qrcode = await import("qrcode-terminal");
    qrcode.default.generate(JSON.stringify(pairingPayload), { small: true });
  }

  private async handleClientMessage(client: ClientState, raw: string): Promise<void> {
    const message = bridgeMessageSchema.parse(JSON.parse(raw));

    if (message.type === "pair.request") {
      const payload = pairRequestPayloadSchema.parse(message.payload);
      const confirm = this.pairingService.acceptPairRequest(payload);
      client.authenticatedDeviceId = confirm.deviceId;
      this.reply(client.socket, message, "pair.confirm", confirm);
      return;
    }

    if (message.type === "auth.response") {
      const payload = authResponsePayloadSchema.parse(message.payload);
      const verified = this.pairingService.verifyChallengeResponse(
        payload.deviceId,
        payload.challengeId,
        payload.signature,
      );
      if (!verified) {
        throw new Error("Authentication challenge failed.");
      }

      client.authenticatedDeviceId = payload.deviceId;
      this.reply(client.socket, message, "auth.response", { authenticated: true });
      return;
    }

    this.assertAuthenticated(client);

    if (message.type === "workspace.list") {
      this.reply(client.socket, message, "workspace.list", workspaceListResponsePayloadSchema.parse({
        workspaces: this.config.allowedWorkspaces.map((root) => ({
          workspaceId: slugifyWorkspace(root),
          name: root.split("/").filter(Boolean).at(-1) ?? root,
          root,
        })),
      }));
      return;
    }

    if (message.type === "thread.list") {
      const threads = await this.codexClient.listThreads();
      const codexThreads = this.sessionIndex.hydrateFromCodexThreads(threads, this.config.allowedWorkspaces);
      const fallback = threads.length === 0
        ? this.sessionIndex.readThreadSummaries(this.config.allowedWorkspaces)
        : [];
      const merged = dedupeThreadSummaries([...codexThreads, ...fallback]).slice(0, 50);
      this.reply(client.socket, message, "thread.list", { threads: merged });
      return;
    }

    if (message.type === "thread.create") {
      const payload = threadCreatePayloadSchema.parse(message.payload);
      const workspace = this.resolveWorkspace(payload.workspaceId);
      const thread = await this.codexClient.startThread(workspace.root, payload.title);
      const summary = this.sessionIndex.hydrateFromCodexThreads([thread], this.config.allowedWorkspaces)[0];
      this.reply(client.socket, message, "thread.create", { thread: summary });
      return;
    }

    if (message.type === "thread.get") {
      const payload = threadGetPayloadSchema.parse(message.payload);
      const thread = await this.codexClient.readThread(payload.threadId);
      this.reply(client.socket, message, "thread.get", {
        thread: this.sessionIndex.toThreadDetail(thread, this.config.allowedWorkspaces),
      });
      return;
    }

    if (message.type === "thread.send") {
      const payload = threadSendPayloadSchema.parse(message.payload);
      await this.codexClient.sendMessage(payload.threadId, payload.message);
      this.reply(client.socket, message, "thread.send", { accepted: true, threadId: payload.threadId });
      return;
    }

    if (message.type === "thread.open_in_codex_app") {
      const payload = threadOpenPayloadSchema.parse(message.payload);
      await openThreadInDesktopApp(payload.threadId);
      this.reply(client.socket, message, "thread.open_in_codex_app", {
        opened: true,
        threadId: payload.threadId,
      });
      return;
    }

    throw new Error(`Unsupported message type: ${message.type}`);
  }

  private handleCodexNotification(notification: { method: string; params?: unknown }): void {
    if (notification.method === "item/agentMessage/delta") {
      const payload = notification.params as { threadId: string; turnId: string; delta: string };
      this.broadcast("thread.stream.delta", threadStreamDeltaPayloadSchema.parse({
        threadId: payload.threadId,
        turnId: payload.turnId,
        chunk: payload.delta,
      }));
      return;
    }

    if (notification.method === "turn/completed") {
      const payload = notification.params as { threadId: string; turn: { id: string } };
      this.broadcast("thread.stream.done", threadStreamDonePayloadSchema.parse({
        threadId: payload.threadId,
        turnId: payload.turn.id,
      }));
      return;
    }

    if (notification.method === "error") {
      const payload = notification.params as { message?: string; threadId?: string };
      this.broadcast("thread.stream.error", threadStreamErrorPayloadSchema.parse({
        threadId: payload.threadId ?? "unknown",
        message: payload.message ?? "Unknown Codex error",
      }));
    }
  }

  private send(socket: WebSocket, message: BridgeMessage): void {
    socket.send(JSON.stringify(message));
  }

  private reply(socket: WebSocket, request: BridgeMessage, type: string, payload: unknown): void {
    this.send(socket, {
      type,
      requestId: request.requestId,
      payload,
    });
  }

  private broadcast(type: string, payload: unknown): void {
    for (const client of this.clients) {
      if (client.authenticatedDeviceId) {
        this.send(client.socket, { type, payload });
      }
    }
  }

  private assertAuthenticated(client: ClientState): void {
    if (!client.authenticatedDeviceId) {
      throw new Error("Client is not authenticated.");
    }
  }

  private resolveWorkspace(workspaceId: string): { workspaceId: string; root: string } {
    const root = this.config.allowedWorkspaces.find((workspace) => slugifyWorkspace(workspace) === workspaceId);
    if (!root) {
      throw new Error(`Workspace ${workspaceId} is not allowed.`);
    }
    return { workspaceId, root };
  }
}

function resolveAdvertisedHost(host: string): string {
  if (host === "0.0.0.0") {
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries ?? []) {
        if (entry.family === "IPv4" && !entry.internal) {
          return entry.address;
        }
      }
    }
    return "127.0.0.1";
  }
  return host;
}

function slugifyWorkspace(root: string): string {
  return root.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "default";
}

function dedupeThreadSummaries(items: ThreadSummary[]): ThreadSummary[] {
  const byId = new Map<string, ThreadSummary>();
  for (const item of items) {
    const current = byId.get(item.threadId);
    if (!current || current.updatedAt < item.updatedAt) {
      byId.set(item.threadId, item);
    }
  }
  return [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
