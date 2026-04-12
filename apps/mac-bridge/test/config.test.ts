import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePositiveInt, resolveAllowedWorkspaces } from "../src/config/index.js";

test("resolveAllowedWorkspaces normalizes and deduplicates roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-workspace-"));
  const child = path.join(root, "child");
  fs.mkdirSync(child);

  const resolved = resolveAllowedWorkspaces(`${child}, ${child}`);

  assert.deepEqual(resolved, [path.resolve(child)]);
});

test("resolveAllowedWorkspaces rejects missing roots", () => {
  const missing = path.join(os.tmpdir(), `codex-remote-missing-${Date.now()}`);

  assert.throws(() => resolveAllowedWorkspaces(missing));
});

test("parsePositiveInt accepts positive integers", () => {
  assert.equal(parsePositiveInt("1234", "PORT"), 1234);
});

test("parsePositiveInt rejects zero and invalid values", () => {
  assert.throws(() => parsePositiveInt("0", "PORT"));
  assert.throws(() => parsePositiveInt("-1", "PORT"));
  assert.throws(() => parsePositiveInt("not-a-number", "PORT"));
});
