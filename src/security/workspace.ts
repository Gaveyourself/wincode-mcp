import { promises as fs } from "node:fs";
import path from "node:path";
import { WinCodeError } from "../errors.js";

export interface ResolvedWorkspacePath {
  absolutePath: string;
  relativePath: string;
}

function normalizeForCompare(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(normalizeForCompare(root), normalizeForCompare(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function nearestExistingParent(input: string): Promise<string> {
  let cursor = input;
  while (true) {
    try {
      await fs.lstat(cursor);
      return cursor;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
}

export class WorkspaceGuard {
  private constructor(
    public readonly configuredRoot: string,
    public readonly canonicalRoot: string,
  ) {}

  static async create(root: string): Promise<WorkspaceGuard> {
    const configuredRoot = path.resolve(root);
    const stat = await fs.stat(configuredRoot);
    if (!stat.isDirectory()) {
      throw new WinCodeError("INVALID_WORKSPACE", `Workspace is not a directory: ${configuredRoot}`);
    }
    const canonicalRoot = await fs.realpath(configuredRoot);
    return new WorkspaceGuard(configuredRoot, canonicalRoot);
  }

  async resolveExisting(userPath = "."): Promise<ResolvedWorkspacePath> {
    const lexical = this.resolveLexically(userPath);
    const canonical = await fs.realpath(lexical);
    this.assertInside(canonical, userPath);
    return { absolutePath: canonical, relativePath: path.relative(this.canonicalRoot, canonical) || "." };
  }

  async resolveForCreate(userPath: string): Promise<ResolvedWorkspacePath> {
    const lexical = this.resolveLexically(userPath);
    const existingParent = await nearestExistingParent(path.dirname(lexical));
    const canonicalParent = await fs.realpath(existingParent);
    this.assertInside(canonicalParent, userPath);

    const suffix = path.relative(existingParent, lexical);
    const candidate = path.resolve(canonicalParent, suffix);
    this.assertInside(candidate, userPath);
    return { absolutePath: candidate, relativePath: path.relative(this.canonicalRoot, candidate) || "." };
  }

  private resolveLexically(userPath: string): string {
    if (userPath.includes("\0")) throw new WinCodeError("INVALID_PATH", "Path contains a NUL byte.");
    const absoluteInput = path.isAbsolute(userPath);
    const candidate = absoluteInput ? path.resolve(userPath) : path.resolve(this.configuredRoot, userPath);

    // Relative paths can be rejected lexically before touching the filesystem.
    // Absolute paths are validated after realpath/nearest-parent resolution. On
    // Windows, configuredRoot can use an 8.3/alias spelling while another tool
    // (notably Git) returns the same directory using its long canonical spelling;
    // comparing those two spellings before realpath would be a false escape.
    if (!absoluteInput && !isInside(this.configuredRoot, candidate)) {
      throw new WinCodeError("OUTSIDE_WORKSPACE", `Path escapes workspace: ${userPath}`);
    }
    return candidate;
  }

  private assertInside(candidate: string, original: string): void {
    if (!isInside(this.canonicalRoot, candidate)) {
      throw new WinCodeError("OUTSIDE_WORKSPACE", `Path resolves outside workspace: ${original}`);
    }
  }
}
