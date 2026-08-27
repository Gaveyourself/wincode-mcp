import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceGuard } from "../src/security/workspace.js";

async function tempWorkspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-workspace-"));
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test("allows paths inside workspace", async () => {
  const fixture = await tempWorkspace();
  try {
    await fs.mkdir(path.join(fixture.root, "src"));
    await fs.writeFile(path.join(fixture.root, "src", "a.txt"), "ok");
    const guard = await WorkspaceGuard.create(fixture.root);
    const result = await guard.resolveExisting(path.join("src", "a.txt"));
    assert.equal(result.relativePath, path.join("src", "a.txt"));
  } finally {
    await fixture.cleanup();
  }
});


test("allows the canonical absolute spelling of the workspace", async () => {
  const fixture = await tempWorkspace();
  try {
    const guard = await WorkspaceGuard.create(fixture.root);
    const canonical = await fs.realpath(fixture.root);
    const result = await guard.resolveExisting(canonical);
    assert.equal(result.relativePath, ".");
  } finally {
    await fixture.cleanup();
  }
});

test("rejects lexical parent traversal", async () => {
  const fixture = await tempWorkspace();
  try {
    const guard = await WorkspaceGuard.create(fixture.root);
    await assert.rejects(() => guard.resolveExisting("../outside.txt"), /escapes workspace/);
  } finally {
    await fixture.cleanup();
  }
});

test("does not confuse sibling prefix with workspace", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-prefix-"));
  const root = path.join(parent, "code");
  const sibling = path.join(parent, "code-evil");
  try {
    await fs.mkdir(root);
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(sibling, "secret.txt"), "secret");
    const guard = await WorkspaceGuard.create(root);
    await assert.rejects(() => guard.resolveExisting(path.join(sibling, "secret.txt")), /outside workspace/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("rejects a symlink escape when symlink creation is permitted", async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-link-"));
  const root = path.join(parent, "workspace");
  const outside = path.join(parent, "outside");
  try {
    await fs.mkdir(root);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
    const link = path.join(root, "link");
    try {
      await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`symlink/junction unavailable: ${String(error)}`);
      return;
    }
    const guard = await WorkspaceGuard.create(root);
    await assert.rejects(() => guard.resolveExisting(path.join("link", "secret.txt")), /resolves outside workspace/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
