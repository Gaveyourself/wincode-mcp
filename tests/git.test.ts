import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { WorkspaceGuard } from "../src/security/workspace.js";
import { GitService } from "../src/services/git.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

test("provides bounded read-only git status, diff and log", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-git-"));
  try {
    await git(root, "init");
    await git(root, "config", "user.name", "WinCode Test");
    await git(root, "config", "user.email", "wincode-test@example.invalid");
    await fs.writeFile(path.join(root, "file.txt"), "one\n", "utf8");
    await git(root, "add", "file.txt");
    await git(root, "commit", "-m", "initial");
    await fs.writeFile(path.join(root, "file.txt"), "one\ntwo\n", "utf8");

    const guard = await WorkspaceGuard.create(root);
    const service = new GitService(guard, 1024 * 1024);
    const status = await service.status();
    assert.ok(status.lines.some(line => line.includes("file.txt")));

    const diff = await service.diff();
    assert.match(diff.text, /\+two/);
    assert.equal(diff.truncated, false);

    const log = await service.log(".", 5);
    assert.equal(log.commits.length, 1);
    assert.equal(log.commits[0].subject, "initial");
    assert.equal(log.commits[0].author, "WinCode Test");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects a parent Git repository whose root is outside workspace", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-git-parent-"));
  const workspace = path.join(parent, "nested-workspace");
  try {
    await git(parent, "init");
    await fs.mkdir(workspace);
    const guard = await WorkspaceGuard.create(workspace);
    const service = new GitService(guard, 1024 * 1024);
    await assert.rejects(() => service.status(), /outside the configured workspace/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
