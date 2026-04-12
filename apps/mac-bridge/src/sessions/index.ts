import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ThreadDetail, ThreadMessage, ThreadSummary } from "@codex-remote/protocol";
import type { CodexThread } from "../types/codex.js";

type SessionIndexRow = {
  id: string;
  thread_name?: string;
  updated_at?: string;
};

export class SessionIndex {
  private readonly codexHome = path.join(os.homedir(), ".codex");
  private readonly sessionIndexPath = path.join(this.codexHome, "session_index.jsonl");

  readThreadSummaries(workspaceRoots: string[]): ThreadSummary[] {
    if (!fs.existsSync(this.sessionIndexPath)) {
      return [];
    }

    const lines = fs.readFileSync(this.sessionIndexPath, "utf8").split("\n").filter(Boolean);
    const summaries = new Map<string, ThreadSummary>();

    for (const line of lines) {
      try {
        const row = JSON.parse(line) as SessionIndexRow;
        const updatedAt = row.updated_at ?? new Date().toISOString();
        const threadId = row.id;
        const title = row.thread_name?.trim() || "Untitled thread";
        const workspaceRoot = workspaceRoots[0] ?? process.cwd();
        summaries.set(threadId, {
          threadId,
          title,
          updatedAt,
          workspaceId: slugifyWorkspace(workspaceRoot),
          lastMessagePreview: title,
          status: "idle",
        });
      } catch {
        continue;
      }
    }

    return [...summaries.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  hydrateFromCodexThreads(threads: CodexThread[], workspaceRoots: string[]): ThreadSummary[] {
    return threads.flatMap((thread) => {
      const workspaceId = matchWorkspaceId(thread.cwd, workspaceRoots);
      if (!workspaceId) {
        return [];
      }

      return [{
        threadId: thread.id,
        title: thread.name ?? (thread.preview || "Untitled thread"),
        updatedAt: new Date(thread.updatedAt * 1000).toISOString(),
        workspaceId,
        lastMessagePreview: thread.preview ?? "",
        status: normalizeStatus(thread.status),
      }];
    });
  }

  toThreadDetail(thread: CodexThread, workspaceRoots: string[]): ThreadDetail | null {
    const workspaceId = matchWorkspaceId(thread.cwd, workspaceRoots);
    if (!workspaceId) {
      return null;
    }

    const messages: ThreadMessage[] = [];
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        if (item.type === "userMessage" && "content" in item) {
          const text = item.content
            .filter((contentItem: { type: string; text?: string }) => contentItem.type === "text")
            .map((contentItem: { type: string; text?: string }) => contentItem.text ?? "")
            .join("\n");
          messages.push({
            id: item.id,
            role: "user",
            text,
          });
        }
        if (item.type === "agentMessage" && "text" in item) {
          messages.push({
            id: item.id,
            role: "assistant",
            text: item.text,
          });
        }
      }
    }

    return {
      threadId: thread.id,
      title: thread.name ?? (thread.preview || "Untitled thread"),
      workspaceId,
      messages,
      status: normalizeStatus(thread.status),
    };
  }
}

function slugifyWorkspace(input: string): string {
  return input.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "default";
}

function matchWorkspaceId(cwd: string, workspaceRoots: string[]): string | null {
  const exact = workspaceRoots.find((root) => isWithinWorkspace(cwd, root));
  if (!exact) {
    return null;
  }
  return slugifyWorkspace(exact);
}

function isWithinWorkspace(cwd: string, root: string): boolean {
  const relative = path.relative(root, cwd);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeStatus(status: CodexThread["status"]): string {
  const normalized = typeof status === "string" ? status : status?.type ?? "idle";
  return normalized === "notLoaded" ? "read_only" : normalized;
}
