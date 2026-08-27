import { WinCodeConfig } from "../config.js";
import { WorkspaceGuard } from "../security/workspace.js";
import { AuditLogger } from "../services/audit.js";
import { FileService } from "../services/files.js";
import { GitService } from "../services/git.js";
import { CommandManager } from "./command-manager.js";

export interface WinCodeRuntime {
  config: WinCodeConfig;
  guard: WorkspaceGuard;
  audit: AuditLogger;
  files: FileService;
  commands: CommandManager;
  commandsEnabled: boolean;
  git: GitService;
}

/**
 * Create the long-lived WinCode runtime state.
 *
 * HTTP serving must reuse one runtime across MCP requests so managed command
 * IDs, audit state and future language-service state remain valid from one
 * request to the next. MCP protocol server instances may be short-lived; this
 * runtime must not be.
 */
export async function createWinCodeRuntime(config: WinCodeConfig): Promise<WinCodeRuntime> {
  const guard = await WorkspaceGuard.create(config.workspace);
  const audit = new AuditLogger(guard.canonicalRoot, config.auditEnabled);
  const files = new FileService(guard, config.maxReadBytes, config.maxWriteBytes, config.maxSearchResults, audit);
  const commandsEnabled = process.env.WINCODE_ALLOW_COMMANDS === "1";
  const commands = new CommandManager(
    guard,
    config.commandOutputBytes,
    commandsEnabled,
    audit,
  );
  const git = new GitService(guard, config.gitOutputBytes);

  return { config, guard, audit, files, commands, commandsEnabled, git };
}
