import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { WinCodeError } from "../errors.js";
import { WorkspaceGuard } from "../security/workspace.js";
import { AuditLogger } from "../services/audit.js";

export type CommandShell = "direct" | "powershell" | "cmd";
export type CommandState = "running" | "exited" | "failed" | "terminated";

interface CommandRecord {
  id: string;
  process: ChildProcessWithoutNullStreams;
  state: CommandState;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  finishedAt: string | null;
  chunks: Buffer[];
  retainedBytes: number;
  baseOffset: number;
  totalBytes: number;
  terminationRequested: boolean;
  completion: Promise<void>;
  resolveCompletion: () => void;
}

export interface StartCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  shell?: CommandShell;
}

export interface CommandSnapshot {
  commandId: string;
  pid: number | undefined;
  state: CommandState;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface CommandOutput extends CommandSnapshot {
  output: string;
  requestedOffset: number;
  actualOffset: number;
  nextOffset: number;
  baseOffset: number;
  totalBytes: number;
  truncatedBeforeOffset: boolean;
}

export interface WaitResult extends CommandSnapshot {
  timedOut: boolean;
}

export class CommandManager {
  private readonly records = new Map<string, CommandRecord>();

  constructor(
    private readonly guard: WorkspaceGuard,
    private readonly outputCapBytes: number,
    private readonly allowCommands: boolean,
    private readonly audit?: AuditLogger,
    private readonly powershellExecutable = process.env.WINCODE_POWERSHELL ?? "pwsh.exe",
  ) {}

  async start(input: StartCommandInput): Promise<CommandSnapshot> {
    if (!this.allowCommands) {
      throw new WinCodeError("COMMANDS_DISABLED", "Command execution is disabled. Set WINCODE_ALLOW_COMMANDS=1 to enable trusted-mode execution.");
    }
    if (!input.command.trim()) throw new WinCodeError("INVALID_COMMAND", "Command must not be empty.");

    const cwd = await this.guard.resolveExisting(input.cwd ?? ".");
    const invocation = this.buildInvocation(input);
    const child = spawn(invocation.executable, invocation.args, {
      cwd: cwd.absolutePath,
      env: process.env,
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });

    let resolveCompletion = () => {};
    const completion = new Promise<void>(resolve => { resolveCompletion = resolve; });
    const id = randomUUID();
    const record: CommandRecord = {
      id,
      process: child,
      state: "running",
      exitCode: null,
      signal: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      chunks: [],
      retainedBytes: 0,
      baseOffset: 0,
      totalBytes: 0,
      terminationRequested: false,
      completion,
      resolveCompletion,
    };
    this.records.set(id, record);

    child.stdout.on("data", (chunk: Buffer | string) => this.append(record, Buffer.from(chunk)));
    child.stderr.on("data", (chunk: Buffer | string) => this.append(record, Buffer.from(chunk)));
    child.on("error", error => {
      this.append(record, Buffer.from(`\n[spawn error] ${error.message}\n`, "utf8"));
      record.state = "failed";
      record.finishedAt ??= new Date().toISOString();
      record.resolveCompletion();
    });
    child.on("close", (code, signal) => {
      record.exitCode = code;
      record.signal = signal;
      record.finishedAt ??= new Date().toISOString();
      record.state = record.terminationRequested ? "terminated" : record.state === "failed" ? "failed" : "exited";
      record.resolveCompletion();
    });

    await this.audit?.record({
      action: "start_command",
      details: {
        commandId: id,
        cwd: cwd.relativePath,
        shell: input.shell ?? "direct",
        commandLabel: (input.shell ?? "direct") === "direct" ? path.basename(input.command) : `<${input.shell ?? "direct"} expression>`,
        argCount: input.args?.length ?? 0,
      },
    });
    return this.snapshot(record);
  }

  status(commandId: string): CommandSnapshot {
    return this.snapshot(this.requireRecord(commandId));
  }

  getOutput(commandId: string, offset = 0, maxBytes = 64 * 1024): CommandOutput {
    const record = this.requireRecord(commandId);
    const requestedOffset = Math.max(0, offset);
    const actualOffset = Math.max(requestedOffset, record.baseOffset);
    const retained = Buffer.concat(record.chunks);
    const start = Math.max(0, actualOffset - record.baseOffset);
    const end = Math.min(retained.length, start + Math.max(1, maxBytes));
    const selected = retained.subarray(start, end);

    return {
      ...this.snapshot(record),
      output: selected.toString("utf8"),
      requestedOffset,
      actualOffset,
      nextOffset: actualOffset + selected.length,
      baseOffset: record.baseOffset,
      totalBytes: record.totalBytes,
      truncatedBeforeOffset: requestedOffset < record.baseOffset,
    };
  }

  async sendInput(commandId: string, input: string, appendNewline = false): Promise<CommandSnapshot> {
    const record = this.requireRecord(commandId);
    if (record.state !== "running" || record.process.stdin.destroyed || !record.process.stdin.writable) {
      throw new WinCodeError("COMMAND_NOT_RUNNING", `Command is not accepting input: ${commandId}`);
    }
    const payload = appendNewline ? `${input}${process.platform === "win32" ? "\r\n" : "\n"}` : input;
    await new Promise<void>((resolve, reject) => {
      record.process.stdin.write(payload, error => error ? reject(error) : resolve());
    });
    await this.audit?.record({ action: "send_command_input", details: { commandId, bytes: Buffer.byteLength(payload), appendNewline } });
    return this.snapshot(record);
  }

  async wait(commandId: string, timeoutMs = 30_000): Promise<WaitResult> {
    const record = this.requireRecord(commandId);
    if (record.state !== "running") return { ...this.snapshot(record), timedOut: false };
    const boundedTimeout = Math.max(0, timeoutMs);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      record.completion.then(() => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), boundedTimeout); }),
    ]);
    if (timer) clearTimeout(timer);
    return { ...this.snapshot(record), timedOut };
  }

  async terminate(commandId: string): Promise<CommandSnapshot> {
    const record = this.requireRecord(commandId);
    if (record.state !== "running") return this.snapshot(record);
    record.terminationRequested = true;
    await this.audit?.record({ action: "terminate_command", details: { commandId } });

    if (process.platform === "win32" && record.process.pid) {
      await new Promise<void>(resolve => {
        const killer = spawn("taskkill.exe", ["/PID", String(record.process.pid), "/T", "/F"], { windowsHide: true });
        killer.once("close", () => resolve());
        killer.once("error", () => {
          record.process.kill();
          resolve();
        });
      });
    } else if (record.process.pid) {
      try {
        process.kill(-record.process.pid, "SIGTERM");
      } catch {
        record.process.kill("SIGTERM");
      }
    }
    return this.snapshot(record);
  }

  private buildInvocation(input: StartCommandInput): { executable: string; args: string[] } {
    const shell = input.shell ?? "direct";
    if (shell === "direct") return { executable: input.command, args: input.args ?? [] };
    if ((input.args?.length ?? 0) > 0) {
      throw new WinCodeError("INVALID_COMMAND", "args must be empty when shell is powershell or cmd; put the full shell expression in command.");
    }
    if (shell === "powershell") {
      return { executable: this.powershellExecutable, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", input.command] };
    }
    return { executable: "cmd.exe", args: ["/d", "/s", "/c", input.command] };
  }

  private append(record: CommandRecord, chunk: Buffer): void {
    record.chunks.push(chunk);
    record.retainedBytes += chunk.length;
    record.totalBytes += chunk.length;
    while (record.retainedBytes > this.outputCapBytes && record.chunks.length > 0) {
      const excess = record.retainedBytes - this.outputCapBytes;
      const first = record.chunks[0];
      if (first.length <= excess) {
        record.chunks.shift();
        record.retainedBytes -= first.length;
        record.baseOffset += first.length;
      } else {
        record.chunks[0] = first.subarray(excess);
        record.retainedBytes -= excess;
        record.baseOffset += excess;
      }
    }
  }

  private requireRecord(commandId: string): CommandRecord {
    const record = this.records.get(commandId);
    if (!record) throw new WinCodeError("UNKNOWN_COMMAND", `Unknown command id: ${commandId}`);
    return record;
  }

  private snapshot(record: CommandRecord): CommandSnapshot {
    return {
      commandId: record.id,
      pid: record.process.pid,
      state: record.state,
      exitCode: record.exitCode,
      signal: record.signal,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
    };
  }
}
