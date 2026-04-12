import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import type { CodexThread, JsonRpcNotification } from "../types/codex.js";
import { JsonRpcClient } from "./jsonRpc.js";

type RuntimeState = "starting" | "ready" | "busy" | "error";

export class CodexAppServerClient extends EventEmitter {
  private process: ReturnType<typeof spawn> | null = null;
  private readonly rpc = new JsonRpcClient();
  private state: RuntimeState = "starting";
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private startGeneration = 0;
  private started = false;

  constructor(private readonly listenPort: number) {
    super();
  }

  getRuntimeState(): RuntimeState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.stopping = false;
    this.startGeneration += 1;
    const generation = this.startGeneration;
    this.clearRestartTimer();
    this.cleanupRuntime();

    this.state = "starting";
    this.emit("runtimeState", this.state);

    this.process = spawn("codex", ["app-server", "--listen", `ws://127.0.0.1:${this.listenPort}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.process.stderr?.on("data", (chunk) => {
      this.emit("stderr", chunk.toString());
    });

    this.process.once("error", (error) => {
      this.state = "error";
      this.emit("runtimeState", this.state);
      this.emit("stderr", `failed to start codex app-server: ${error.message}`);
      this.scheduleRestart(generation);
    });

    this.process.once("exit", () => {
      this.state = "error";
      this.emit("runtimeState", this.state);
      this.scheduleRestart(generation);
    });

    await waitForServerBoot(this.listenPort);
    await this.rpc.connect(`ws://127.0.0.1:${this.listenPort}`);
    this.rpc.on("notification", (notification) => this.handleNotification(notification as JsonRpcNotification));
    this.rpc.on("close", () => {
      this.state = "error";
      this.emit("runtimeState", this.state);
      this.scheduleRestart(generation);
    });

    await this.rpc.request("initialize", {
      clientInfo: {
        name: "codex-remote-bridge",
        title: "Codex Remote Bridge",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.rpc.notify("initialized");
    this.state = "ready";
    this.emit("runtimeState", this.state);
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.stopping = true;
    this.clearRestartTimer();
    this.cleanupRuntime();
    this.state = "error";
    this.emit("runtimeState", this.state);
  }

  async listThreads(limit = 30): Promise<CodexThread[]> {
    const result = await this.rpc.request<{ data: CodexThread[] }>("thread/list", {
      limit,
      archived: false,
    });
    return result.data;
  }

  async readThread(threadId: string): Promise<CodexThread> {
    const result = await this.rpc.request<{ thread: CodexThread }>("thread/read", {
      threadId,
      includeTurns: true,
    });
    return result.thread;
  }

  async startThread(cwd: string, title: string): Promise<CodexThread> {
    const result = await this.rpc.request<{ thread: CodexThread }>("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });
    await this.rpc.request("thread/name/set", {
      threadId: result.thread.id,
      name: title,
    });
    return await this.readThread(result.thread.id);
  }

  async sendMessage(threadId: string, message: string): Promise<void> {
    await this.rpc.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: message,
          text_elements: [],
        },
      ],
    });
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "turn/started") {
      this.state = "busy";
      this.emit("runtimeState", this.state);
    }
    if (notification.method === "turn/completed") {
      this.state = "ready";
      this.emit("runtimeState", this.state);
    }

    this.emit("notification", notification);
  }

  private scheduleRestart(generation: number): void {
    if (this.stopping || generation !== this.startGeneration) {
      return;
    }

    this.clearRestartTimer();
    this.cleanupRuntime();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping || generation !== this.startGeneration) {
        return;
      }
      this.started = false;
      void this.start();
    }, 2000);
  }

  private cleanupRuntime(): void {
    if (this.process) {
      this.process.removeAllListeners();
      this.process = null;
    }
    this.rpc.removeAllListeners();
    this.rpc.close();
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}

async function waitForServerBoot(port: number): Promise<void> {
  const WebSocket = (await import("ws")).default;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const probe = new WebSocket(`ws://127.0.0.1:${port}`);
      await once(probe, "open");
      probe.close();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw new Error("Timed out waiting for codex app-server to start.");
}
