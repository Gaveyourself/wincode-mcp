import { spawn } from "node:child_process";
import path from "node:path";

import { WinCodeError } from "../errors.js";
import { WorkspaceGuard } from "../security/workspace.js";

export interface GitStatusResult {
  repoRoot: string;
  lines: string[];
}

export interface GitDiffResult {
  repoRoot: string;
  text: string;
  truncated: boolean;
  totalBytes: number;
}

export interface GitLogEntry {
  hash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  totalStdoutBytes: number;
  stdoutTruncated: boolean;
}

function comparePath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(comparePath(root), comparePath(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class GitService {
  constructor(
    private readonly guard: WorkspaceGuard,
    private readonly outputCapBytes: number,
    private readonly gitExecutable = process.env.WINCODE_GIT ?? "git",
  ) {}

  async status(userCwd = "."): Promise<GitStatusResult> {
    const repo = await this.resolveRepo(userCwd);
    const result = await this.run(["status", "--porcelain", "--branch"], repo.absolutePath);
    this.assertSuccess(result, "git status");
    return { repoRoot: repo.relativePath, lines: result.stdout.split(/\r?\n/).filter(Boolean) };
  }

  async diff(userCwd = ".", staged = false, userPath?: string): Promise<GitDiffResult> {
    const repo = await this.resolveRepo(userCwd);
    const args = ["diff", "--no-ext-diff", "--no-textconv"];
    if (staged) args.push("--cached");
    if (userPath) {
      const safePath = this.validateRepoPath(userPath);
      args.push("--", safePath);
    }
    const result = await this.run(args, repo.absolutePath);
    this.assertSuccess(result, "git diff");
    return {
      repoRoot: repo.relativePath,
      text: result.stdout,
      truncated: result.stdoutTruncated,
      totalBytes: result.totalStdoutBytes,
    };
  }

  async log(userCwd = ".", limit = 20): Promise<{ repoRoot: string; commits: GitLogEntry[] }> {
    const repo = await this.resolveRepo(userCwd);
    const bounded = Math.min(Math.max(1, limit), 100);
    const format = "%H%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e";
    const result = await this.run(["log", `-${bounded}`, "--date=iso", `--pretty=format:${format}`], repo.absolutePath);
    this.assertSuccess(result, "git log");
    const commits = result.stdout
      .split("\x1e")
      .map(record => record.trim())
      .filter(Boolean)
      .map(record => {
        const [hash = "", author = "", email = "", date = "", subject = ""] = record.split("\x1f");
        return { hash, author, email, date, subject };
      });
    return { repoRoot: repo.relativePath, commits };
  }

  private async resolveRepo(userCwd: string): Promise<{ absolutePath: string; relativePath: string }> {
    const cwd = await this.guard.resolveExisting(userCwd);
    const probe = await this.run(["rev-parse", "--show-toplevel"], cwd.absolutePath);
    this.assertSuccess(probe, "git rev-parse");
    const rootText = probe.stdout.trim();
    if (!rootText) throw new WinCodeError("NOT_GIT_REPOSITORY", `No Git repository found from: ${userCwd}`);
    try {
      return await this.guard.resolveExisting(rootText);
    } catch (error) {
      throw new WinCodeError("GIT_REPO_OUTSIDE_WORKSPACE", `Git repository root is outside the configured workspace: ${rootText}`);
    }
  }

  private validateRepoPath(userPath: string): string {
    if (path.isAbsolute(userPath) || userPath.includes("\0") || userPath.split(/[\\/]+/).includes("..") || userPath.startsWith(":")) {
      throw new WinCodeError("INVALID_GIT_PATH", `Unsafe Git path: ${userPath}`);
    }
    return userPath;
  }

  private async run(args: string[], cwd: string): Promise<RunResult> {
    return await new Promise<RunResult>((resolve, reject) => {
      const child = spawn(this.gitExecutable, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_PAGER: "cat", PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let retainedStdout = 0;
      let totalStdout = 0;
      let retainedStderr = 0;

      child.stdout.on("data", (chunk: Buffer | string) => {
        const data = Buffer.from(chunk);
        totalStdout += data.length;
        if (retainedStdout < this.outputCapBytes) {
          const selected = data.subarray(0, this.outputCapBytes - retainedStdout);
          stdoutChunks.push(selected);
          retainedStdout += selected.length;
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        const data = Buffer.from(chunk);
        if (retainedStderr < 64 * 1024) {
          const selected = data.subarray(0, 64 * 1024 - retainedStderr);
          stderrChunks.push(selected);
          retainedStderr += selected.length;
        }
      });
      child.once("error", reject);
      child.once("close", code => resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: code ?? -1,
        totalStdoutBytes: totalStdout,
        stdoutTruncated: totalStdout > retainedStdout,
      }));
    });
  }

  private assertSuccess(result: RunResult, operation: string): void {
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
      throw new WinCodeError("GIT_ERROR", `${operation} failed: ${detail.slice(0, 2000)}`);
    }
  }
}
