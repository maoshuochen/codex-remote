import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import WebSocket from "ws";
import type {
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccess,
} from "../types/codex.js";

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export class JsonRpcClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  async connect(url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once("open", () => {
        this.socket = socket;
        socket.on("message", (data) => this.handleMessage(data.toString()));
        socket.on("close", () => this.emit("close"));
        resolve();
      });
      socket.once("error", (error) => reject(error));
    });
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.socket) {
      throw new Error("JSON-RPC socket is not connected.");
    }

    const id = crypto.randomUUID();
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return await new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket?.send(JSON.stringify(payload));
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.socket) {
      throw new Error("JSON-RPC socket is not connected.");
    }

    this.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      } satisfies JsonRpcNotification),
    );
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  private handleMessage(raw: string): void {
    const payload = JSON.parse(raw) as JsonRpcSuccess | JsonRpcError | JsonRpcNotification;
    if ("id" in payload && "result" in payload) {
      const pending = this.pending.get(payload.id);
      if (pending) {
        this.pending.delete(payload.id);
        pending.resolve(payload.result);
      }
      return;
    }

    if ("id" in payload && "error" in payload) {
      const key = payload.id ?? "";
      const pending = this.pending.get(key);
      if (pending) {
        this.pending.delete(key);
        pending.reject(new Error(payload.error.message));
      }
      return;
    }

    this.emit("notification", payload);
  }
}
