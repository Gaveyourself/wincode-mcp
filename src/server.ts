import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { errorMessage } from "./errors.js";
import { WinCodeRuntime } from "./runtime/runtime.js";

function jsonText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function toolError(error: unknown) {
  return { content: [{ type: "text" as const, text: errorMessage(error) }], isError: true };
}

export function createWinCodeServer(runtime: WinCodeRuntime): McpServer {
  const { config, guard, files, commands, commandsEnabled, git } = runtime;
  const server = new McpServer({ name: "wincode-mcp", version: "0.3.0" });

  server.registerTool("health", { description: "Return WinCode MCP runtime health and configuration summary." }, async () =>
    jsonText({
      ok: true,
      name: "wincode-mcp",
      version: "0.3.0",
      platform: process.platform,
      node: process.version,
      workspace: guard.canonicalRoot,
      commandsEnabled,
      auditEnabled: config.auditEnabled,
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
      description: "Read a bounded UTF-8 file inside the workspace and return its SHA-256.",
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
    "write_file",
    {
      description: "Create or overwrite a bounded UTF-8 file inside the workspace. expectedSha256 prevents stale overwrites.",
      inputSchema: z.object({
        path: z.string().min(1),
        text: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      }),
    },
    async ({ path, text, expectedSha256 }) => {
      try { return jsonText(await files.writeFile(path, text, expectedSha256)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "apply_patch",
    {
      description: "Apply a context-checked unified diff to one existing UTF-8 file. Conflicting context fails without writing.",
      inputSchema: z.object({
        path: z.string().min(1),
        patch: z.string().min(1),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      }),
    },
    async ({ path, patch, expectedSha256 }) => {
      try { return jsonText(await files.applyPatch(path, patch, expectedSha256)); } catch (error) { return toolError(error); }
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
    "send_command_input",
    {
      description: "Send bounded text input to a still-running managed command.",
      inputSchema: z.object({
        commandId: z.string().uuid(),
        input: z.string().max(256 * 1024),
        appendNewline: z.boolean().default(false),
      }),
    },
    async ({ commandId, input, appendNewline }) => {
      try { return jsonText(await commands.sendInput(commandId, input, appendNewline)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "wait_command",
    {
      description: "Wait for a managed command to finish, bounded by timeoutMs.",
      inputSchema: z.object({
        commandId: z.string().uuid(),
        timeoutMs: z.number().int().min(0).max(60_000).default(30_000),
      }),
    },
    async ({ commandId, timeoutMs }) => {
      try { return jsonText(await commands.wait(commandId, timeoutMs)); } catch (error) { return toolError(error); }
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

  server.registerTool(
    "git_status",
    {
      description: "Return read-only Git status for a repository whose root must stay inside the workspace.",
      inputSchema: z.object({ cwd: z.string().default(".") }),
    },
    async ({ cwd }) => {
      try { return jsonText(await git.status(cwd)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "git_diff",
    {
      description: "Return a bounded read-only Git diff.",
      inputSchema: z.object({
        cwd: z.string().default("."),
        staged: z.boolean().default(false),
        path: z.string().optional(),
      }),
    },
    async ({ cwd, staged, path }) => {
      try { return jsonText(await git.diff(cwd, staged, path)); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "git_log",
    {
      description: "Return bounded read-only Git commit history.",
      inputSchema: z.object({
        cwd: z.string().default("."),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    },
    async ({ cwd, limit }) => {
      try { return jsonText(await git.log(cwd, limit)); } catch (error) { return toolError(error); }
    },
  );

  return server;
}
