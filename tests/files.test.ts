import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceGuard } from "../src/security/workspace.js";
import { FileService } from "../src/services/files.js";

test("lists, reads and searches workspace files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-files-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "hello.txt"), "alpha\nbeta needle\ngamma\n", "utf8");
    const guard = await WorkspaceGuard.create(root);
    const files = new FileService(guard, 64 * 1024, 50);

    const listing = await files.listDirectory("src");
    assert.equal(listing.length, 1);
    assert.equal(listing[0].path, path.join("src", "hello.txt"));

    const read = await files.readFile(path.join("src", "hello.txt"));
    assert.match(read.text, /beta needle/);
    assert.equal(read.truncated, false);

    const hits = await files.searchText("needle");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
