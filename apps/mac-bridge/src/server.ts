import crypto from "node:crypto";
import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  approvalListResponsePayloadSchema,
  approvalRequestSchema,
  approvalResolvePayloadSchema,
  approvalResolveResponsePayloadSchema,
  approvalResolvedPayloadSchema,
  approvalRequestedPayloadSchema,
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
  type ApprovalKind,
  type ApprovalRequest,
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
import type { JsonRpcServerRequest } from "./types/codex.js";

type ClientState = {
  socket: WebSocket;
  authenticatedDeviceId: string | null;
};

type RuntimeState = "starting" | "ready" | "busy" | "error";

type PendingApproval = ApprovalRequest & {
  rawRequestId: string;
};

export class BridgeServer {
  private readonly httpServer = createServer();
  private readonly wsServer: WebSocketServer;
  private readonly clients = new Set<ClientState>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly pairingService: PairingService;
  private readonly sessionIndex = new SessionIndex();
  private started = false;
  private runtimeState: RuntimeState = "starting";
  private readonly handleRuntimeState = (state: RuntimeState) => {
    this.runtimeState = state;
    this.broadcast("runtime.status", { state } satisfies RuntimeStatusPayload);
  };
  private readonly handleNotification = (notification: { method: string; params?: unknown }) => {
    this.handleCodexNotification(notification);
  };
  private readonly handleServerRequest = (request: JsonRpcServerRequest) => {
    this.handleCodexServerRequest(request);
  };
  private readonly handleStderr = (stderr: string) => log("warn", "codex app-server stderr", { stderr });
  private readonly handleRequest = (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(this.getHealthSnapshot()));
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      this.serveWebAsset(request, response);
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  };

  constructor(
    private readonly config: BridgeConfig,
    private readonly identity: BridgeIdentity,
    private readonly codexClient: CodexAppServerClient,
  ) {
    this.wsServer = new WebSocketServer({
      server: this.httpServer,
      verifyClient: ({ origin }, done) => done(this.isAllowedOrigin(origin)),
    });
    this.pairingService = new PairingService(config, identity);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.httpServer.on("request", this.handleRequest);
    this.codexClient.on("runtimeState", this.handleRuntimeState);
    this.codexClient.on("notification", this.handleNotification);
    this.codexClient.on("serverRequest", this.handleServerRequest);
    this.codexClient.on("stderr", this.handleStderr);

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

    const advertisedHost = this.config.advertisedHost ?? resolveAdvertisedHost(this.config.host);
    const bridgeUrl = `ws://${advertisedHost}:${this.config.port}`;
    const webUrl = `http://${advertisedHost}:${this.config.port}`;
    const pairingPayload = this.pairingService.issuePairingQr(bridgeUrl, webUrl, createPairingToken());
    const pairingUrl = buildPairingUrl(webUrl, pairingPayload);
    log("info", "bridge server listening", {
      host: this.config.host,
      port: this.config.port,
      webUrl,
      pairingUrl,
      pairingPayload,
    });

    const qrcode = await import("qrcode-terminal");
    qrcode.default.generate(pairingUrl, { small: true });
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.httpServer.off("request", this.handleRequest);
    this.codexClient.off("runtimeState", this.handleRuntimeState);
    this.codexClient.off("notification", this.handleNotification);
    this.codexClient.off("serverRequest", this.handleServerRequest);
    this.codexClient.off("stderr", this.handleStderr);

    for (const client of this.clients) {
      client.socket.removeAllListeners();
      client.socket.close(1001, "bridge shutting down");
    }
    this.clients.clear();

    this.wsServer.close();
    this.httpServer.close();
  }

  getHealthSnapshot(): {
    started: boolean;
    runtimeState: RuntimeState;
    connectedClients: number;
    allowedWorkspaces: number;
    authenticatedClients: number;
  } {
    return {
      started: this.started,
      runtimeState: this.runtimeState,
      connectedClients: this.clients.size,
      allowedWorkspaces: this.config.allowedWorkspaces.length,
      authenticatedClients: [...this.clients].filter((client) => client.authenticatedDeviceId !== null).length,
    };
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
      const fallback = threads.length === 0 && this.config.allowedWorkspaces.length === 1
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
      const detail = this.sessionIndex.toThreadDetail(thread, this.config.allowedWorkspaces);
      if (!detail) {
        throw new Error("Thread is outside the configured workspaces.");
      }
      this.reply(client.socket, message, "thread.get", {
        thread: detail,
      });
      return;
    }

    if (message.type === "thread.send") {
      const payload = threadSendPayloadSchema.parse(message.payload);
      const thread = await this.codexClient.readThread(payload.threadId);
      if (!this.sessionIndex.toThreadDetail(thread, this.config.allowedWorkspaces)) {
        throw new Error("Thread is outside the configured workspaces.");
      }
      await this.codexClient.sendMessage(payload.threadId, payload.message);
      this.reply(client.socket, message, "thread.send", { accepted: true, threadId: payload.threadId });
      return;
    }

    if (message.type === "thread.open_in_codex_app") {
      const payload = threadOpenPayloadSchema.parse(message.payload);
      const thread = await this.codexClient.readThread(payload.threadId);
      if (!this.sessionIndex.toThreadDetail(thread, this.config.allowedWorkspaces)) {
        throw new Error("Thread is outside the configured workspaces.");
      }
      await openThreadInDesktopApp(payload.threadId);
      this.reply(client.socket, message, "thread.open_in_codex_app", {
        opened: true,
        threadId: payload.threadId,
      });
      return;
    }

    if (message.type === "approval.list") {
      this.reply(client.socket, message, "approval.list", approvalListResponsePayloadSchema.parse({
        approvals: this.visibleApprovals(),
      }));
      return;
    }

    if (message.type === "approval.resolve") {
      const payload = approvalResolvePayloadSchema.parse(message.payload);
      const approval = this.pendingApprovals.get(payload.approvalId);
      if (!approval) {
        throw new Error("Approval request is no longer pending.");
      }
      this.pendingApprovals.delete(payload.approvalId);
      this.codexClient.resolveServerRequest(approval.rawRequestId, payload.result);
      const resolved = approvalResolvedPayloadSchema.parse({ approvalId: payload.approvalId });
      this.broadcast("approval.resolved", resolved);
      this.reply(client.socket, message, "approval.resolve", approvalResolveResponsePayloadSchema.parse({
        resolved: true,
        approvalId: payload.approvalId,
      }));
      return;
    }

    throw new Error(`Unsupported message type: ${message.type}`);
  }

  private handleCodexServerRequest(request: JsonRpcServerRequest): void {
    if (!isApprovalMethod(request.method)) {
      log("warn", "unsupported codex server request", { method: request.method });
      this.codexClient.resolveServerRequest(request.id, { error: "unsupported_request" });
      return;
    }

    const approval = toPendingApproval(request);
    this.pendingApprovals.set(approval.approvalId, approval);
    this.broadcast("approval.requested", approvalRequestedPayloadSchema.parse({
      approval: this.toVisibleApproval(approval),
    }));
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

  private visibleApprovals(): ApprovalRequest[] {
    return [...this.pendingApprovals.values()].map((approval) => this.toVisibleApproval(approval));
  }

  private toVisibleApproval(approval: PendingApproval): ApprovalRequest {
    const { rawRequestId: _rawRequestId, ...visible } = approval;
    return approvalRequestSchema.parse(visible);
  }

  private assertAuthenticated(client: ClientState): void {
    if (!client.authenticatedDeviceId) {
      throw new Error("Client is not authenticated.");
    }
  }

  private serveWebAsset(request: IncomingMessage, response: ServerResponse): void {
    const requestUrl = new URL(request.url ?? "/", "http://bridge.local");
    const pathname = decodeURIComponent(requestUrl.pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidate = path.resolve(this.config.webDistDir, relativePath);
    const root = path.resolve(this.config.webDistDir);
    const assetPath = candidate.startsWith(root + path.sep) || candidate === root ? candidate : path.join(root, "index.html");
    const filePath = fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()
      ? assetPath
      : path.join(root, "index.html");

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "web_dist_not_found" }));
      return;
    }

    response.writeHead(200, { "content-type": contentTypeFor(filePath) });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    response.end(fs.readFileSync(filePath));
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) {
      return true;
    }
    if (this.config.allowedOrigins.includes(origin)) {
      return true;
    }
    try {
      const parsed = new URL(origin);
      const advertisedHost = this.config.advertisedHost ?? resolveAdvertisedHost(this.config.host);
      const allowedHosts = new Set([
        "localhost",
        "127.0.0.1",
        "::1",
        this.config.host,
        advertisedHost,
      ]);
      return parsed.protocol === "http:" && parsed.port === String(this.config.port) && allowedHosts.has(parsed.hostname);
    } catch {
      return false;
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

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath);
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function buildPairingUrl(webUrl: string, payload: unknown): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${webUrl.replace(/\/+$/, "")}/#pair=${encodedPayload}`;
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

function isApprovalMethod(method: string): boolean {
  return [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
  ].includes(method);
}

function toPendingApproval(request: JsonRpcServerRequest): PendingApproval {
  const params = asRecord(request.params);
  const approvalId = crypto.randomUUID();
  const visible = approvalRequestSchema.parse({
    approvalId,
    method: request.method,
    kind: approvalKindForMethod(request.method),
    threadId: stringField(params, "threadId"),
    turnId: stringField(params, "turnId"),
    itemId: stringField(params, "itemId"),
    reason: stringField(params, "reason"),
    summary: summarizeApproval(request.method, params),
    choices: deriveApprovalChoices(request.method, params),
    createdAt: new Date().toISOString(),
    params,
  });
  return {
    ...visible,
    rawRequestId: request.id,
  };
}

function approvalKindForMethod(method: string): ApprovalKind {
  if (method === "item/commandExecution/requestApproval") {
    return "command";
  }
  if (method === "item/fileChange/requestApproval") {
    return "file_change";
  }
  if (method === "item/permissions/requestApproval") {
    return "permission";
  }
  if (method === "item/tool/requestUserInput") {
    return "user_input";
  }
  return "unknown";
}

function deriveApprovalChoices(method: string, params: Record<string, unknown>): string[] {
  if (method === "item/commandExecution/requestApproval") {
    const choices = arrayField(params, "availableDecisions").flatMap((item) => {
      if (typeof item === "string") {
        return [item];
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return Object.keys(item);
      }
      return [];
    });
    return choices.length > 0 ? choices : ["accept", "acceptForSession", "decline", "cancel"];
  }
  if (method === "item/fileChange/requestApproval") {
    return ["accept", "acceptForSession", "decline", "cancel"];
  }
  if (method === "item/permissions/requestApproval") {
    return ["session", "turn", "decline"];
  }
  if (method === "item/tool/requestUserInput") {
    return ["answer"];
  }
  return ["accept", "decline"];
}

function summarizeApproval(method: string, params: Record<string, unknown>): string {
  if (method === "item/commandExecution/requestApproval") {
    return stringField(params, "command") || "Command approval requested";
  }
  if (method === "item/fileChange/requestApproval") {
    return stringField(params, "summary") || "File change approval requested";
  }
  if (method === "item/permissions/requestApproval") {
    return stringField(params, "reason") || "Additional permissions requested";
  }
  if (method === "item/tool/requestUserInput") {
    return firstQuestionPrompt(params) || "Codex is waiting for input";
  }
  return method;
}

function firstQuestionPrompt(params: Record<string, unknown>): string {
  for (const item of arrayField(params, "questions")) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const question = stringField(item as Record<string, unknown>, "question");
      const prompt = stringField(item as Record<string, unknown>, "prompt");
      if (question) {
        return question;
      }
      if (prompt) {
        return prompt;
      }
    }
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

function arrayField(params: Record<string, unknown>, key: string): unknown[] {
  const value = params[key];
  return Array.isArray(value) ? value : [];
}
