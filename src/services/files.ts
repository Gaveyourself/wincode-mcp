import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import { WinCodeError } from "../errors.js";
import { WorkspaceGuard } from "../security/workspace.js";
import { AuditLogger } from "./audit.js";

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
  sha256: string;
}

export interface WriteResult {
  path: string;
  bytesWritten: number;
  sha256: string;
  created: boolean;
}

export interface PatchResult extends WriteResult {
  hunksApplied: number;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

interface ParsedHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

const DEFAULT_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".wincode"]);
const SHA256_RE = /^[a-f0-9]{64}$/i;

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function splitText(text: string): { lines: string[]; newline: string; finalNewline: boolean } {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = text.endsWith("\n");
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (finalNewline) lines.pop();
  return { lines, newline, finalNewline };
}

function parseUnifiedPatch(patchText: string): ParsedHunk[] {
  const lines = patchText.replace(/\r\n/g, "\n").split("\n");
  const hunks: ParsedHunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("diff ") || line.startsWith("index ") || line === "") {
      index++;
      continue;
    }
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) throw new WinCodeError("INVALID_PATCH", `Unexpected patch line: ${line.slice(0, 200)}`);

    const hunk: ParsedHunk = {
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4]),
      lines: [],
    };
    index++;
    while (index < lines.length && !lines[index].startsWith("@@ ")) {
      const hunkLine = lines[index];
      if (hunkLine.startsWith("--- ") || hunkLine.startsWith("+++ ") || hunkLine.startsWith("diff ") || hunkLine.startsWith("index ")) break;
      if (hunkLine === "\\ No newline at end of file") {
        index++;
        continue;
      }
      if (hunkLine.length === 0) {
        // A truly empty patch payload line is invalid; an empty context line must be " ".
        if (index === lines.length - 1) { index++; break; }
        throw new WinCodeError("INVALID_PATCH", "Patch hunk contains an unprefixed empty line.");
      }
      if (!" +-".includes(hunkLine[0])) throw new WinCodeError("INVALID_PATCH", `Invalid hunk line: ${hunkLine.slice(0, 200)}`);
      hunk.lines.push(hunkLine);
      index++;
    }

    const oldSeen = hunk.lines.filter(item => item[0] !== "+").length;
    const newSeen = hunk.lines.filter(item => item[0] !== "-").length;
    if (oldSeen !== hunk.oldCount || newSeen !== hunk.newCount) {
      throw new WinCodeError("INVALID_PATCH", `Hunk line counts do not match header: expected -${hunk.oldCount}/+${hunk.newCount}, got -${oldSeen}/+${newSeen}`);
    }
    hunks.push(hunk);
  }

  if (hunks.length === 0) throw new WinCodeError("INVALID_PATCH", "Patch contains no hunks.");
  return hunks;
}

export class FileService {
  constructor(
    private readonly guard: WorkspaceGuard,
    private readonly maxReadBytes: number,
    private readonly maxWriteBytes: number,
    private readonly maxSearchResults: number,
    private readonly audit?: AuditLogger,
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
      const selected = buffer.subarray(0, bytesRead);
      return {
        path: resolved.relativePath,
        text: selected.toString("utf8"),
        bytesRead,
        truncated: stat.size > bytesRead,
        sha256: stat.size === bytesRead ? sha256(selected) : await sha256File(resolved.absolutePath),
      };
    } finally {
      await handle.close();
    }
  }

  async writeFile(userPath: string, text: string, expectedSha256?: string): Promise<WriteResult> {
    const data = Buffer.from(text, "utf8");
    if (data.length > this.maxWriteBytes) {
      throw new WinCodeError("WRITE_TOO_LARGE", `Write exceeds maximum of ${this.maxWriteBytes} bytes.`);
    }
    if (expectedSha256 && !SHA256_RE.test(expectedSha256)) throw new WinCodeError("INVALID_SHA256", "expectedSha256 must be a 64-character hex digest.");

    let created = false;
    let resolved;
    try {
      resolved = await this.guard.resolveExisting(userPath);
      const stat = await fs.stat(resolved.absolutePath);
      if (!stat.isFile()) throw new WinCodeError("NOT_FILE", `Not a regular file: ${userPath}`);
      const current = await fs.readFile(resolved.absolutePath);
      if (expectedSha256 && sha256(current).toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new WinCodeError("STALE_FILE", `File changed since it was read: ${userPath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (expectedSha256) throw new WinCodeError("STALE_FILE", `File does not exist but expectedSha256 was supplied: ${userPath}`);
      resolved = await this.guard.resolveForCreate(userPath);
      created = true;
    }

    await fs.writeFile(resolved.absolutePath, data, { flag: "w" });
    const digest = sha256(data);
    await this.audit?.record({ action: "write_file", details: { path: resolved.relativePath, bytesWritten: data.length, created, sha256: digest } });
    return { path: resolved.relativePath, bytesWritten: data.length, sha256: digest, created };
  }

  async applyPatch(userPath: string, patchText: string, expectedSha256?: string): Promise<PatchResult> {
    const resolved = await this.guard.resolveExisting(userPath);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) throw new WinCodeError("NOT_FILE", `Not a regular file: ${userPath}`);
    const currentBuffer = await fs.readFile(resolved.absolutePath);
    const currentSha = sha256(currentBuffer);
    if (expectedSha256 && currentSha.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new WinCodeError("STALE_FILE", `File changed since it was read: ${userPath}`);
    }

    const currentText = currentBuffer.toString("utf8");
    const format = splitText(currentText);
    const hunks = parseUnifiedPatch(patchText);
    const output: string[] = [];
    let cursor = 0;

    for (const hunk of hunks) {
      const targetIndex = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
      if (targetIndex < cursor) throw new WinCodeError("PATCH_CONFLICT", "Patch hunks overlap or are out of order.");
      output.push(...format.lines.slice(cursor, targetIndex));
      let sourceIndex = targetIndex;

      for (const patchLine of hunk.lines) {
        const prefix = patchLine[0];
        const payload = patchLine.slice(1);
        if (prefix === " ") {
          if (format.lines[sourceIndex] !== payload) {
            throw new WinCodeError("PATCH_CONFLICT", `Context mismatch at original line ${sourceIndex + 1}.`);
          }
          output.push(payload);
          sourceIndex++;
        } else if (prefix === "-") {
          if (format.lines[sourceIndex] !== payload) {
            throw new WinCodeError("PATCH_CONFLICT", `Removal mismatch at original line ${sourceIndex + 1}.`);
          }
          sourceIndex++;
        } else if (prefix === "+") {
          output.push(payload);
        }
      }
      cursor = sourceIndex;
    }

    output.push(...format.lines.slice(cursor));
    let nextText = output.join(format.newline);
    if (format.finalNewline) nextText += format.newline;
    const data = Buffer.from(nextText, "utf8");
    if (data.length > this.maxWriteBytes) throw new WinCodeError("WRITE_TOO_LARGE", `Patched file exceeds maximum of ${this.maxWriteBytes} bytes.`);

    await fs.writeFile(resolved.absolutePath, data, { flag: "w" });
    const digest = sha256(data);
    await this.audit?.record({ action: "apply_patch", details: { path: resolved.relativePath, hunksApplied: hunks.length, bytesWritten: data.length, sha256: digest } });
    return { path: resolved.relativePath, bytesWritten: data.length, sha256: digest, created: false, hunksApplied: hunks.length };
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
