import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceGuard } from "../src/security/workspace.js";
import { AuditLogger } from "../src/services/audit.js";
import { FileService } from "../src/services/files.js";

test("lists, reads, searches, writes and patches workspace files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-files-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "hello.txt"), "alpha\nbeta needle\ngamma\n", "utf8");
    const guard = await WorkspaceGuard.create(root);
    const audit = new AuditLogger(guard.canonicalRoot, true);
    const files = new FileService(guard, 64 * 1024, 64 * 1024, 50, audit);

    const listing = await files.listDirectory("src");
    assert.equal(listing.length, 1);
    assert.equal(listing[0].path, path.join("src", "hello.txt"));

    const read = await files.readFile(path.join("src", "hello.txt"));
    assert.match(read.text, /beta needle/);
    assert.equal(read.truncated, false);
    assert.match(read.sha256, /^[a-f0-9]{64}$/);

    const hits = await files.searchText("needle");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);

    const created = await files.writeFile(path.join("src", "created.txt"), "first\n");
    assert.equal(created.created, true);
    assert.equal((await fs.readFile(path.join(root, "src", "created.txt"), "utf8")), "first\n");

    const createdRead = await files.readFile(path.join("src", "created.txt"));
    const updated = await files.writeFile(path.join("src", "created.txt"), "second\n", createdRead.sha256);
    assert.equal(updated.created, false);

    await fs.writeFile(path.join(root, "src", "created.txt"), "external change\n", "utf8");
    await assert.rejects(
      () => files.writeFile(path.join("src", "created.txt"), "stale overwrite\n", updated.sha256),
      /changed since it was read/,
    );

    const beforePatch = await files.readFile(path.join("src", "hello.txt"));
    const patch = [
      "@@ -1,3 +1,3 @@",
      " alpha",
      "-beta needle",
      "+beta changed",
      " gamma",
      "",
    ].join("\n");
    const patched = await files.applyPatch(path.join("src", "hello.txt"), patch, beforePatch.sha256);
    assert.equal(patched.hunksApplied, 1);
    assert.equal(await fs.readFile(path.join(root, "src", "hello.txt"), "utf8"), "alpha\nbeta changed\ngamma\n");

    const afterPatch = await files.readFile(path.join("src", "hello.txt"));
    const conflictingPatch = [
      "@@ -1,3 +1,3 @@",
      " alpha",
      "-not present",
      "+replacement",
      " gamma",
      "",
    ].join("\n");
    await assert.rejects(
      () => files.applyPatch(path.join("src", "hello.txt"), conflictingPatch, afterPatch.sha256),
      /mismatch/,
    );
    assert.equal(await fs.readFile(path.join(root, "src", "hello.txt"), "utf8"), "alpha\nbeta changed\ngamma\n");

    const auditText = await fs.readFile(path.join(root, ".wincode", "audit.jsonl"), "utf8");
    assert.match(auditText, /"action":"write_file"/);
    assert.match(auditText, /"action":"apply_patch"/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
