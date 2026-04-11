import test from "node:test";
import assert from "node:assert/strict";
import { SessionIndex } from "../src/sessions/index.js";

test("session index maps codex thread to summary and detail", () => {
  const sessions = new SessionIndex();
  const [summary] = sessions.hydrateFromCodexThreads(
    [
      {
        id: "thread-1",
        preview: "hello world",
        updatedAt: 1_710_000_000,
        status: "ready",
        cwd: "/tmp/project",
        name: "Greeting",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                type: "userMessage",
                id: "msg-1",
                content: [{ type: "text", text: "hello world" }],
              },
              {
                type: "agentMessage",
                id: "msg-2",
                text: "hi there",
              },
            ],
          },
        ],
      },
    ],
    ["/tmp/project"],
  );

  assert.equal(summary.title, "Greeting");
  const detail = sessions.toThreadDetail(
    {
      id: "thread-1",
      preview: "hello world",
      updatedAt: 1_710_000_000,
      status: "ready",
      cwd: "/tmp/project",
      name: "Greeting",
      turns: [
        {
          id: "turn-1",
          items: [
            {
              type: "userMessage",
              id: "msg-1",
              content: [{ type: "text", text: "hello world" }],
            },
            {
              type: "agentMessage",
              id: "msg-2",
              text: "hi there",
            },
          ],
        },
      ],
    },
    ["/tmp/project"],
  );

  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[1]?.text, "hi there");
});

test("session index matches workspace boundaries without prefix collisions", () => {
  const sessions = new SessionIndex();
  const [summary] = sessions.hydrateFromCodexThreads(
    [
      {
        id: "thread-2",
        preview: "workspace preview",
        updatedAt: 1_710_000_001,
        status: "ready",
        cwd: "/tmp/project2/app",
        turns: [],
      },
    ],
    ["/tmp/project", "/tmp/project2"],
  );

  assert.equal(summary.workspaceId, "tmp-project2");
});
