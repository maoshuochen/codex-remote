import { execFile } from "node:child_process";

export function openThreadInDesktopApp(threadId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("open", [`codex://threads/${threadId}`], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
