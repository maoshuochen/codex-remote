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

  constructor(private readonly listenPort: number) {
    super();
  }

  getRuntimeState(): RuntimeState {
    return this.state;
  }

  async start(): Promise<void> {
    this.state = "starting";
    this.emit("runtimeState", this.state);

    this.process = spawn(
      "codex",
      ["app-server", "--listen", `ws://127.0.0.1:${this.listenPort}`],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    this.process.stderr?.on("data", (chunk) => {
      this.emit("stderr", chunk.toString());
    });

    this.process.once("exit", () => {
      this.state = "error";
      this.emit("runtimeState", this.state);
      setTimeout(() => {
        void this.start();
      }, 2000);
    });

    await waitForServerBoot(this.listenPort);
    await this.rpc.connect(`ws://127.0.0.1:${this.listenPort}`);
    this.rpc.on("notification", (notification) => this.handleNotification(notification as JsonRpcNotification));
    this.rpc.on("close", () => {
      this.state = "error";
      this.emit("runtimeState", this.state);
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
