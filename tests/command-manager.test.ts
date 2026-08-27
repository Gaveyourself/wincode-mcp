import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CommandManager } from "../src/runtime/command-manager.js";
import { WorkspaceGuard } from "../src/security/workspace.js";

async function waitForExit(manager: CommandManager, id: string): Promise<void> {
  const result = await manager.wait(id, 5000);
  if (result.timedOut) throw new Error("command did not exit in time");
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

test("sends stdin and waits event-driven for completion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-cmd-stdin-"));
  try {
    const guard = await WorkspaceGuard.create(root);
    const manager = new CommandManager(guard, 1024 * 1024, true);
    const started = await manager.start({
      command: process.execPath,
      args: ["-e", "process.stdin.setEncoding('utf8'); process.stdin.once('data', d => { process.stdout.write('got:' + d.trim()); process.exit(0); });"],
    });
    await manager.sendInput(started.commandId, "ping", true);
    const waited = await manager.wait(started.commandId, 5000);
    assert.equal(waited.timedOut, false);
    assert.equal(waited.state, "exited");
    assert.match(manager.getOutput(started.commandId).output, /got:ping/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
