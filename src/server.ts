import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { WinCodeConfig } from "./config.js";
import { errorMessage } from "./errors.js";
import { CommandManager } from "./runtime/command-manager.js";
import { WorkspaceGuard } from "./security/workspace.js";
import { FileService } from "./services/files.js";

function jsonText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function toolError(error: unknown) {
  return { content: [{ type: "text" as const, text: errorMessage(error) }], isError: true };
}

export async function createWinCodeServer(config: WinCodeConfig): Promise<McpServer> {
  const guard = await WorkspaceGuard.create(config.workspace);
  const files = new FileService(guard, config.maxReadBytes, config.maxSearchResults);
  const commands = new CommandManager(
    guard,
    config.commandOutputBytes,
    process.env.WINCODE_ALLOW_COMMANDS === "1",
  );

  const server = new McpServer({ name: "wincode-mcp", version: "0.1.0" });

  server.registerTool("health", { description: "Return WinCode MCP runtime health and configuration summary." }, async () =>
    jsonText({
      ok: true,
      name: "wincode-mcp",
      version: "0.1.0",
      platform: process.platform,
      node: process.version,
      workspace: guard.canonicalRoot,
      commandsEnabled: process.env.WINCODE_ALLOW_COMMANDS === "1",
    }),
  );

  server.registerTool(
    "list_directory",
    {
      description: "List a bounded directory inside the configured workspace.",
      inputSchema: z.object({
        path: z.string().default("."),
        maxEntries: z.number().int().min(1).max(1000).default(200),
      }),
    },
    async ({ path, maxEntries }) => {
      try { return jsonText(await files.listDirectory(path, maxEntries)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "read_file",
    {
      description: "Read a bounded UTF-8 file inside the workspace.",
      inputSchema: z.object({
        path: z.string().min(1),
        maxBytes: z.number().int().min(1).optional(),
      }),
    },
    async ({ path, maxBytes }) => {
      try { return jsonText(await files.readFile(path, maxBytes)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "search_files",
    {
      description: "Search UTF-8 text files recursively inside the workspace. Symlink directories are not followed.",
      inputSchema: z.object({
        query: z.string().min(1),
        path: z.string().default("."),
        maxResults: z.number().int().min(1).max(1000).optional(),
      }),
    },
    async ({ query, path, maxResults }) => {
      try { return jsonText(await files.searchText(query, path, maxResults)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "start_command",
    {
      description: "Start a managed trusted-mode command. Disabled unless WINCODE_ALLOW_COMMANDS=1.",
      inputSchema: z.object({
        command: z.string().min(1),
        args: z.array(z.string()).optional(),
        cwd: z.string().default("."),
        shell: z.enum(["direct", "powershell", "cmd"]).default("direct"),
      }),
    },
    async input => {
      try { return jsonText(await commands.start(input)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "get_command_status",
    {
      description: "Get status for a managed command.",
      inputSchema: z.object({ commandId: z.string().uuid() }),
    },
    async ({ commandId }) => {
      try { return jsonText(commands.status(commandId)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "get_command_output",
    {
      description: "Read bounded combined stdout/stderr from a managed command using byte offsets.",
      inputSchema: z.object({
        commandId: z.string().uuid(),
        offset: z.number().int().min(0).default(0),
        maxBytes: z.number().int().min(1).max(512 * 1024).default(64 * 1024),
      }),
    },
    async ({ commandId, offset, maxBytes }) => {
      try { return jsonText(commands.getOutput(commandId, offset, maxBytes)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "terminate_command",
    {
      description: "Terminate a managed command and its process tree when possible.",
      inputSchema: z.object({ commandId: z.string().uuid() }),
    },
    async ({ commandId }) => {
      try { return jsonText(await commands.terminate(commandId)); } catch (error) { return toolError(error); }
    },
  );

  return server;
}
