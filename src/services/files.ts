import { promises as fs } from "node:fs";
import path from "node:path";

import { WinCodeError } from "../errors.js";
import { WorkspaceGuard } from "../security/workspace.js";

export interface DirectoryEntry {
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size?: number;
}

export interface ReadResult {
  path: string;
  text: string;
  bytesRead: number;
  truncated: boolean;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

const DEFAULT_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".wincode"]);

export class FileService {
  constructor(
    private readonly guard: WorkspaceGuard,
    private readonly maxReadBytes: number,
    private readonly maxSearchResults: number,
  ) {}

  async listDirectory(userPath = ".", maxEntries = 200): Promise<DirectoryEntry[]> {
    const resolved = await this.guard.resolveExisting(userPath);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isDirectory()) throw new WinCodeError("NOT_DIRECTORY", `Not a directory: ${userPath}`);

    const names = await fs.readdir(resolved.absolutePath);
    names.sort((a, b) => a.localeCompare(b));
    const output: DirectoryEntry[] = [];

    for (const name of names.slice(0, Math.max(1, maxEntries))) {
      const absolute = path.join(resolved.absolutePath, name);
      const item = await fs.lstat(absolute);
      const relative = path.relative(this.guard.canonicalRoot, absolute) || ".";
      output.push({
        path: relative,
        type: item.isSymbolicLink() ? "symlink" : item.isDirectory() ? "directory" : item.isFile() ? "file" : "other",
        size: item.isFile() ? item.size : undefined,
      });
    }
    return output;
  }

  async readFile(userPath: string, maxBytes = this.maxReadBytes): Promise<ReadResult> {
    const resolved = await this.guard.resolveExisting(userPath);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) throw new WinCodeError("NOT_FILE", `Not a regular file: ${userPath}`);

    const limit = Math.min(Math.max(1, maxBytes), this.maxReadBytes);
    const handle = await fs.open(resolved.absolutePath, "r");
    try {
      const toRead = Math.min(stat.size, limit);
      const buffer = Buffer.alloc(toRead);
      const { bytesRead } = await handle.read(buffer, 0, toRead, 0);
      return {
        path: resolved.relativePath,
        text: buffer.subarray(0, bytesRead).toString("utf8"),
        bytesRead,
        truncated: stat.size > bytesRead,
      };
    } finally {
      await handle.close();
    }
  }

  async searchText(query: string, userPath = ".", maxResults = this.maxSearchResults): Promise<SearchHit[]> {
    if (!query) throw new WinCodeError("INVALID_QUERY", "Search query must not be empty.");
    const root = await this.guard.resolveExisting(userPath);
    const limit = Math.min(Math.max(1, maxResults), this.maxSearchResults);
    const hits: SearchHit[] = [];

    const visit = async (absolute: string): Promise<void> => {
      if (hits.length >= limit) return;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        if (absolute !== root.absolutePath && DEFAULT_IGNORED_DIRS.has(path.basename(absolute))) return;
        const children = await fs.readdir(absolute);
        children.sort((a, b) => a.localeCompare(b));
        for (const child of children) {
          if (hits.length >= limit) break;
          await visit(path.join(absolute, child));
        }
        return;
      }
      if (!stat.isFile() || stat.size > this.maxReadBytes) return;

      const data = await fs.readFile(absolute);
      if (data.includes(0)) return;
      const lines = data.toString("utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length && hits.length < limit; i++) {
        if (lines[i].includes(query)) {
          hits.push({
            path: path.relative(this.guard.canonicalRoot, absolute),
            line: i + 1,
            text: lines[i].slice(0, 1000),
          });
        }
      }
    };

    await visit(root.absolutePath);
    return hits;
  }
}
