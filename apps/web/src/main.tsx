import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  ApprovalRequest,
  BridgeMessage,
  PairingQrPayload,
  RuntimeStatusPayload,
  ThreadDetail,
  ThreadSummary,
  Workspace,
} from "@codex-remote/protocol";
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import "./styles.css";

ed25519.hashes.sha512 = sha512;

type ConnectionPhase = "not_paired" | "pairing" | "connecting" | "syncing" | "ready" | "offline" | "error";
type RuntimeState = RuntimeStatusPayload["state"] | "offline";
type Destination = "threads" | "approvals" | "settings";

type StoredPairing = {
  bridgeUrl: string;
  deviceId: string;
  privateKeySeed: string;
};

type AppState = {
  phase: ConnectionPhase;
  runtime: RuntimeState;
  threads: ThreadSummary[];
  workspaces: Workspace[];
  approvals: ApprovalRequest[];
  selectedThread: ThreadDetail | null;
  error: string | null;
};

type PendingReply = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

const pairingStorageKey = "codex_remote_pairing";
const encoder = new TextEncoder();

class BridgeClient {
  private socket: WebSocket | null = null;
  private pairing: StoredPairing | null = null;
  private pending = new Map<string, PendingReply>();
  private trusted = false;

  constructor(
    private readonly setState: React.Dispatch<React.SetStateAction<AppState>>,
  ) {}

  async restore(): Promise<void> {
    const pairing = loadPairing();
    if (!pairing) {
      this.setState((state) => ({ ...state, phase: "not_paired" }));
      return;
    }
    this.pairing = pairing;
    this.trusted = true;
    this.connect(pairing.bridgeUrl, "connecting");
  }

  async pair(rawInput: string): Promise<void> {
    const payload = parsePairingInput(rawInput);
    const privateKeySeed = ed25519.utils.randomSecretKey();
    const publicKey = exportPublicKeyPem(ed25519.getPublicKey(privateKeySeed));
    const deviceId = crypto.randomUUID();
    this.pairing = { bridgeUrl: payload.bridgeUrl, deviceId, privateKeySeed: bytesToBase64(privateKeySeed) };
    this.trusted = false;
    this.setState((state) => ({ ...state, phase: "pairing", error: null }));
    await this.connect(payload.bridgeUrl, "pairing");
    await this.sendForReply("pair.request", {
      pairingToken: payload.pairingToken,
      deviceId,
      deviceName: browserDeviceName(),
      publicKey,
    });
    savePairing(this.pairing);
    this.trusted = true;
    await this.bootstrap();
  }

  reconnect(): void {
    const pairing = this.pairing ?? loadPairing();
    if (!pairing) {
      this.setState((state) => ({ ...state, phase: "not_paired" }));
      return;
    }
    this.pairing = pairing;
    void this.restore();
  }

  disconnect(): void {
    this.socket?.close(1000, "disconnect");
    this.socket = null;
    this.failPending(new Error("Disconnected from bridge."));
    this.setState((state) => ({ ...state, phase: this.pairing ? "offline" : "not_paired", runtime: "offline" }));
  }

  clearPairing(): void {
    localStorage.removeItem(pairingStorageKey);
    this.pairing = null;
    this.trusted = false;
    this.disconnect();
    this.setState({
      phase: "not_paired",
      runtime: "offline",
      threads: [],
      workspaces: [],
      approvals: [],
      selectedThread: null,
      error: null,
    });
  }

  async bootstrap(): Promise<void> {
    this.setState((state) => ({ ...state, phase: "syncing" }));
    const workspaces = await this.sendForReply<{ workspaces: Workspace[] }>("workspace.list", {});
    this.setState((state) => ({ ...state, workspaces: workspaces.workspaces }));
    await Promise.all([this.refreshThreads(), this.refreshApprovals()]);
    this.setState((state) => ({ ...state, phase: "ready" }));
  }

  async refreshThreads(): Promise<void> {
    const response = await this.sendForReply<{ threads: ThreadSummary[] }>("thread.list", {});
    this.setState((state) => ({ ...state, threads: response.threads }));
  }

  async refreshApprovals(): Promise<void> {
    const response = await this.sendForReply<{ approvals: ApprovalRequest[] }>("approval.list", {});
    this.setState((state) => ({ ...state, approvals: response.approvals }));
  }

  async openThread(threadId: string): Promise<void> {
    const response = await this.sendForReply<{ thread: ThreadDetail }>("thread.get", { threadId });
    this.setState((state) => ({ ...state, selectedThread: response.thread }));
  }

  async createThread(title: string): Promise<void> {
    const workspaceId = this.getFirstWorkspaceId();
    const response = await this.sendForReply<{ thread: ThreadSummary }>("thread.create", { workspaceId, title });
    this.setState((state) => ({ ...state, threads: [response.thread, ...state.threads] }));
    await this.openThread(response.thread.threadId);
  }

  async sendMessage(threadId: string, message: string): Promise<void> {
    await this.sendForReply("thread.send", { threadId, message });
    this.setState((state) => ({
      ...state,
      runtime: "busy",
      selectedThread: state.selectedThread?.threadId === threadId
        ? {
          ...state.selectedThread,
          messages: [
            ...state.selectedThread.messages,
            {
              id: crypto.randomUUID(),
              role: "user",
              text: message,
              createdAt: new Date().toISOString(),
            },
          ],
        }
        : state.selectedThread,
    }));
  }

  async openInCodex(threadId: string): Promise<void> {
    await this.sendForReply("thread.open_in_codex_app", { threadId });
  }

  async resolveApproval(approvalId: string, decision: string): Promise<void> {
    await this.sendForReply("approval.resolve", { approvalId, result: { decision } });
    this.setState((state) => ({
      ...state,
      approvals: state.approvals.filter((approval) => approval.approvalId !== approvalId),
    }));
  }

  private async connect(bridgeUrl: string, phase: ConnectionPhase): Promise<void> {
    this.socket?.close(1000, "reconnect");
    this.setState((state) => ({ ...state, phase, runtime: "offline", error: null }));
    this.socket = new WebSocket(bridgeUrl);
    this.socket.addEventListener("message", (event) => {
      void this.handleMessage(JSON.parse(String(event.data)) as BridgeMessage);
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      this.failPending(new Error("WebSocket closed."));
      this.setState((state) => ({ ...state, phase: this.pairing ? "offline" : "not_paired", runtime: "offline" }));
    });
    this.socket.addEventListener("error", () => {
      this.publishError(new Error("Could not connect to the Mac bridge."));
    });
    await waitForOpen(this.socket);
  }

  private async handleMessage(message: BridgeMessage): Promise<void> {
    const pending = message.requestId ? this.pending.get(message.requestId) : undefined;
    if (pending) {
      this.pending.delete(message.requestId ?? "");
      if (message.type === "error") {
        pending.reject(new Error(errorMessage(message.payload)));
      } else {
        pending.resolve(message.payload);
      }
    }

    switch (message.type) {
      case "auth.challenge":
        await this.respondToChallenge(message.payload as { challengeId?: string; nonce?: string } | undefined);
        break;
      case "runtime.status":
        this.setState((state) => ({ ...state, runtime: (message.payload as RuntimeStatusPayload).state }));
        break;
      case "thread.list":
        this.setState((state) => ({ ...state, threads: ((message.payload as { threads?: ThreadSummary[] }).threads ?? []) }));
        break;
      case "thread.get":
        this.setState((state) => ({ ...state, selectedThread: (message.payload as { thread?: ThreadDetail }).thread ?? state.selectedThread }));
        break;
      case "thread.stream.delta":
        this.applyDelta(message.payload as { threadId?: string; chunk?: string });
        break;
      case "thread.stream.done":
        this.setState((state) => ({ ...state, runtime: "ready" }));
        void this.refreshThreads();
        break;
      case "thread.stream.error":
        this.publishError(new Error(errorMessage(message.payload)));
        break;
      case "approval.list":
        this.setState((state) => ({ ...state, approvals: ((message.payload as { approvals?: ApprovalRequest[] }).approvals ?? []) }));
        break;
      case "approval.requested":
        this.upsertApproval((message.payload as { approval?: ApprovalRequest }).approval);
        break;
      case "approval.resolved":
        this.removeApproval((message.payload as { approvalId?: string }).approvalId);
        break;
      case "error":
        this.publishError(new Error(errorMessage(message.payload)));
        break;
    }
  }

  private async respondToChallenge(payload: { challengeId?: string; nonce?: string } | undefined): Promise<void> {
    if (!this.trusted || !this.pairing || !payload?.challengeId || !payload.nonce) {
      return;
    }
    const signature = ed25519.sign(encoder.encode(payload.nonce), base64ToBytes(this.pairing.privateKeySeed));
    await this.sendForReply("auth.response", {
      deviceId: this.pairing.deviceId,
      challengeId: payload.challengeId,
      signature: bytesToBase64(signature),
    });
    await this.bootstrap();
  }

  private sendForReply<T = unknown>(type: string, payload: unknown): Promise<T> {
    const requestId = crypto.randomUUID();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected to your Mac bridge."));
    }
    const message: BridgeMessage = { type, requestId, payload };
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Bridge request timed out."));
      }, 20_000);
      this.pending.set(requestId, {
        resolve: (reply) => {
          window.clearTimeout(timeout);
          resolve(reply as T);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      });
      socket.send(JSON.stringify(message));
    });
  }

  private applyDelta(payload: { threadId?: string; chunk?: string }): void {
    if (!payload.threadId || payload.chunk === undefined) {
      return;
    }
    this.setState((state) => {
      const selectedThread = state.selectedThread;
      if (!selectedThread || selectedThread.threadId !== payload.threadId) {
        return state;
      }
      const messages = [...selectedThread.messages];
      const last = messages.at(-1);
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, text: `${last.text}${payload.chunk}` };
      } else {
        messages.push({ id: crypto.randomUUID(), role: "assistant", text: payload.chunk ?? "", createdAt: new Date().toISOString() });
      }
      return { ...state, runtime: "busy", selectedThread: { ...selectedThread, messages } };
    });
  }

  private upsertApproval(approval: ApprovalRequest | undefined): void {
    if (!approval) {
      return;
    }
    this.setState((state) => ({
      ...state,
      approvals: [approval, ...state.approvals.filter((item) => item.approvalId !== approval.approvalId)],
    }));
  }

  private removeApproval(approvalId: string | undefined): void {
    if (!approvalId) {
      return;
    }
    this.setState((state) => ({
      ...state,
      approvals: state.approvals.filter((approval) => approval.approvalId !== approvalId),
    }));
  }

  private publishError(error: unknown): void {
    const message = error instanceof Error ? error.message : "Unknown bridge error.";
    this.setState((state) => ({ ...state, phase: state.phase === "not_paired" ? "not_paired" : "error", error: message }));
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private getFirstWorkspaceId(): string {
    const workspaceId = loadWorkspacesFromState().at(0)?.workspaceId;
    if (!workspaceId) {
      throw new Error("Workspaces are still loading.");
    }
    return workspaceId;
  }
}

let latestWorkspaces: Workspace[] = [];

function App() {
  const [state, setState] = useState<AppState>({
    phase: "not_paired",
    runtime: "offline",
    threads: [],
    workspaces: [],
    approvals: [],
    selectedThread: null,
    error: null,
  });
  const [destination, setDestination] = useState<Destination>("threads");
  const [draft, setDraft] = useState("");
  const [pairingText, setPairingText] = useState("");
  const [newThreadTitle, setNewThreadTitle] = useState("New remote chat");
  const clientRef = useRef<BridgeClient | null>(null);
  latestWorkspaces = state.workspaces;

  const client = useMemo(() => {
    const bridgeClient = new BridgeClient(setState);
    clientRef.current = bridgeClient;
    return bridgeClient;
  }, []);

  useEffect(() => {
    void client.restore();
    return () => client.disconnect();
  }, [client]);

  if (state.phase === "not_paired") {
    return (
      <main className="pairing-shell">
        <section className="pairing-panel">
          <div>
            <p className="eyebrow">Codex Remote</p>
            <h1>Pair this browser with your Mac</h1>
            <p className="muted">Codex still runs on your Mac. This page is only the control surface; pair it with the Mac bridge before opening threads or sending messages.</p>
          </div>
          <ol className="pairing-steps">
            <li>
              <strong>Start the bridge on your Mac</strong>
              <code>npm run dev:bridge</code>
            </li>
            <li>
              <strong>Copy the pairing payload printed in the terminal</strong>
              <span>When using GitHub Pages, paste the full JSON object. When using the bridge-hosted URL, the token alone is enough.</span>
            </li>
            <li>
              <strong>Paste it below and pair</strong>
              <span>The browser will save a local key for reconnecting to this Mac.</span>
            </li>
          </ol>
          <textarea
            value={pairingText}
            onChange={(event) => setPairingText(event.target.value)}
            placeholder='Paste the full pairing JSON here, for example {"bridgeUrl":"ws://192.168.1.20:8787","webUrl":"http://192.168.1.20:8787","pairingToken":"..."}'
          />
          {state.error ? <p className="error">{state.error}</p> : null}
          <button className="primary" onClick={() => void client.pair(pairingText)}>Pair browser</button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">C</span>
          <div>
            <strong>Codex Remote</strong>
            <small>{phaseLabel(state.phase)} · {state.runtime}</small>
          </div>
        </div>
        <nav>
          <button className={destination === "threads" ? "active" : ""} onClick={() => setDestination("threads")}>Threads</button>
          <button className={destination === "approvals" ? "active" : ""} onClick={() => setDestination("approvals")}>Approvals {state.approvals.length ? `(${state.approvals.length})` : ""}</button>
          <button className={destination === "settings" ? "active" : ""} onClick={() => setDestination("settings")}>Settings</button>
        </nav>
        <div className="sidebar-actions">
          <button onClick={() => client.reconnect()}>Reconnect</button>
          <button onClick={() => void client.refreshThreads()}>Refresh</button>
        </div>
      </aside>

      <section className="content">
        {state.error ? <div className="banner">{state.error}</div> : null}
        {destination === "threads" ? (
          <ThreadsView
            state={state}
            draft={draft}
            newThreadTitle={newThreadTitle}
            setDraft={setDraft}
            setNewThreadTitle={setNewThreadTitle}
            onCreate={() => void client.createThread(newThreadTitle)}
            onOpen={(threadId) => void client.openThread(threadId)}
            onSend={() => {
              const threadId = state.selectedThread?.threadId;
              if (!threadId || !draft.trim()) {
                return;
              }
              const message = draft.trim();
              setDraft("");
              void client.sendMessage(threadId, message);
            }}
            onOpenInCodex={() => {
              const threadId = state.selectedThread?.threadId;
              if (threadId) {
                void client.openInCodex(threadId);
              }
            }}
          />
        ) : null}
        {destination === "approvals" ? (
          <ApprovalsView approvals={state.approvals} onResolve={(approvalId, decision) => void client.resolveApproval(approvalId, decision)} />
        ) : null}
        {destination === "settings" ? (
          <SettingsView state={state} onClear={() => client.clearPairing()} />
        ) : null}
      </section>
    </main>
  );
}

function ThreadsView(props: {
  state: AppState;
  draft: string;
  newThreadTitle: string;
  setDraft: (value: string) => void;
  setNewThreadTitle: (value: string) => void;
  onCreate: () => void;
  onOpen: (threadId: string) => void;
  onSend: () => void;
  onOpenInCodex: () => void;
}) {
  return (
    <div className="threads-layout">
      <section className="thread-list">
        <div className="section-header">
          <h2>Threads</h2>
          <span>{props.state.threads.length}</span>
        </div>
        <div className="new-thread">
          <input value={props.newThreadTitle} onChange={(event) => props.setNewThreadTitle(event.target.value)} />
          <button onClick={props.onCreate}>New</button>
        </div>
        {props.state.threads.map((thread) => (
          <button
            key={thread.threadId}
            className={`thread-row ${props.state.selectedThread?.threadId === thread.threadId ? "selected" : ""}`}
            onClick={() => props.onOpen(thread.threadId)}
          >
            <strong>{thread.title}</strong>
            <span>{thread.lastMessagePreview || thread.status}</span>
          </button>
        ))}
      </section>
      <section className="thread-detail">
        {props.state.selectedThread ? (
          <>
            <div className="detail-header">
              <div>
                <h2>{props.state.selectedThread.title}</h2>
                <span>{workspaceName(props.state.selectedThread.workspaceId, props.state.workspaces)}</span>
              </div>
              <button onClick={props.onOpenInCodex}>Open in Codex.app</button>
            </div>
            <div className="messages">
              {props.state.selectedThread.messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <span>{message.role}</span>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
            <div className="composer">
              <textarea value={props.draft} onChange={(event) => props.setDraft(event.target.value)} placeholder="Send a follow-up" />
              <button className="primary" onClick={props.onSend}>Send</button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>Select a thread</h2>
            <p>Open an existing Codex thread or create a new one in an allowed workspace.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ApprovalsView(props: { approvals: ApprovalRequest[]; onResolve: (approvalId: string, decision: string) => void }) {
  return (
    <section className="approval-list">
      <div className="section-header">
        <h2>Approvals</h2>
        <span>{props.approvals.length}</span>
      </div>
      {props.approvals.length === 0 ? <p className="muted">No pending approvals.</p> : null}
      {props.approvals.map((approval) => (
        <article className="approval" key={approval.approvalId}>
          <div>
            <strong>{approval.summary}</strong>
            <p>{approval.kind} · {approval.reason || approval.method}</p>
          </div>
          <div className="approval-actions">
            {approval.choices.map((choice) => (
              <button key={choice} onClick={() => props.onResolve(approval.approvalId, choice)}>{choice}</button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function SettingsView(props: { state: AppState; onClear: () => void }) {
  const pairing = loadPairing();
  return (
    <section className="settings">
      <h2>Settings</h2>
      <dl>
        <dt>Bridge</dt>
        <dd>{pairing?.bridgeUrl ?? "Not paired"}</dd>
        <dt>Device</dt>
        <dd>{pairing?.deviceId ?? "Not paired"}</dd>
        <dt>Workspaces</dt>
        <dd>{props.state.workspaces.map((workspace) => workspace.root).join(", ") || "None loaded"}</dd>
      </dl>
      <button className="danger" onClick={props.onClear}>Forget pairing</button>
    </section>
  );
}

function loadPairing(): StoredPairing | null {
  const raw = localStorage.getItem(pairingStorageKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredPairing;
  } catch {
    return null;
  }
}

function savePairing(pairing: StoredPairing): void {
  localStorage.setItem(pairingStorageKey, JSON.stringify(pairing));
}

function parsePairingInput(rawInput: string): PairingQrPayload {
  const input = rawInput.trim();
  if (input.startsWith("{")) {
    return JSON.parse(input) as PairingQrPayload;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return {
    bridgeUrl: `${protocol}//${window.location.host}`,
    webUrl: window.location.href,
    deviceName: "Mac bridge",
    pairingToken: input,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    bridgePublicKeyFingerprint: "unknown",
  };
}

function exportPublicKeyPem(publicKey: Uint8Array): string {
  const spki = bytesToBase64(concatBytes(hexToBytes("302a300506032b6570032100"), publicKey));
  const lines = spki.match(/.{1,64}/g)?.join("\n") ?? spki;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }
  return btoa(value);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to the Mac bridge.")), { once: true });
  });
}

function errorMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
    return payload.message;
  }
  return "Bridge request failed.";
}

function browserDeviceName(): string {
  return `Web ${navigator.platform || "Browser"}`;
}

function phaseLabel(phase: ConnectionPhase): string {
  return phase.replace("_", " ");
}

function workspaceName(workspaceId: string, workspaces: Workspace[]): string {
  return workspaces.find((workspace) => workspace.workspaceId === workspaceId)?.name ?? workspaceId;
}

function loadWorkspacesFromState(): Workspace[] {
  return latestWorkspaces;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
