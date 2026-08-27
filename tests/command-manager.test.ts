import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CommandManager } from "../src/runtime/command-manager.js";
import { WorkspaceGuard } from "../src/security/workspace.js";

async function waitForExit(manager: CommandManager, id: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (manager.status(id).state !== "running") return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("command did not exit in time");
}

test("commands are disabled unless explicitly enabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-cmd-off-"));
  try {
    const guard = await WorkspaceGuard.create(root);
    const manager = new CommandManager(guard, 1024 * 1024, false);
    await assert.rejects(() => manager.start({ command: process.execPath, args: ["-e", "process.exit(0)"] }), /disabled/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("captures managed command output in trusted mode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-cmd-on-"));
  try {
    const guard = await WorkspaceGuard.create(root);
    const manager = new CommandManager(guard, 1024 * 1024, true);
    const started = await manager.start({
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello'); process.stderr.write(' world')"],
    });
    await waitForExit(manager, started.commandId);
    const output = manager.getOutput(started.commandId);
    assert.match(output.output, /hello/);
    assert.match(output.output, /world/);
    assert.equal(manager.status(started.commandId).state, "exited");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
