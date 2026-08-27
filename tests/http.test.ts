import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WinCodeConfig } from "../src/config.js";
import { startWinCodeHttpServer } from "../src/http-server.js";
import { createWinCodeRuntime } from "../src/runtime/runtime.js";

function configFor(workspace: string): WinCodeConfig {
  return {
    workspace,
    maxReadBytes: 64 * 1024,
    maxWriteBytes: 64 * 1024,
    maxSearchResults: 50,
    commandOutputBytes: 1024 * 1024,
    gitOutputBytes: 1024 * 1024,
    auditEnabled: false,
  };
}

async function postLegacyMcp(port: number, id: number, method: string, params: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  const dataLine = body.split(/\r?\n/).find(line => line.startsWith("data: "));
  assert.ok(dataLine, `missing SSE data line in response: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>;
}

function toolText(response: Record<string, unknown>): string {
  const result = response.result as { content?: Array<{ type?: string; text?: string }> } | undefined;
  const item = result?.content?.find(entry => entry.type === "text");
  assert.ok(item?.text, "missing text tool result");
  return item.text;
}

test("serves loopback HTTP and preserves managed command state across MCP requests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-http-"));
  const previousAllowCommands = process.env.WINCODE_ALLOW_COMMANDS;
  process.env.WINCODE_ALLOW_COMMANDS = "1";
  const runtime = await createWinCodeRuntime(configFor(root));
  if (previousAllowCommands === undefined) delete process.env.WINCODE_ALLOW_COMMANDS;
  else process.env.WINCODE_ALLOW_COMMANDS = previousAllowCommands;

  const running = await startWinCodeHttpServer(runtime, { host: "127.0.0.1", port: 0 });
  try {
    const health = await fetch(`http://127.0.0.1:${running.port}/health`);
    assert.equal(health.status, 200);
    const body = await health.json() as { ok: boolean; version: string; transport: string };
    assert.equal(body.ok, true);
    assert.equal(body.version, "0.3.0");
    assert.equal(body.transport, "http");

    const initialized = await postLegacyMcp(running.port, 1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "wincode-http-test", version: "1.0.0" },
    });
    assert.match(JSON.stringify(initialized), /wincode-mcp/);

    const startedResponse = await postLegacyMcp(running.port, 2, "tools/call", {
      name: "start_command",
      arguments: {
        command: process.execPath,
        args: ["-e", "setTimeout(() => process.stdout.write('cross-request-ok'), 40)"],
      },
    });
    const started = JSON.parse(toolText(startedResponse)) as { commandId: string };
    assert.match(started.commandId, /^[0-9a-f-]{36}$/i);

    const waitedResponse = await postLegacyMcp(running.port, 3, "tools/call", {
      name: "wait_command",
      arguments: { commandId: started.commandId, timeoutMs: 3000 },
    });
    const waited = JSON.parse(toolText(waitedResponse)) as { state: string };
    assert.equal(waited.state, "exited");

    const outputResponse = await postLegacyMcp(running.port, 4, "tools/call", {
      name: "get_command_output",
      arguments: { commandId: started.commandId, offset: 0, maxBytes: 65536 },
    });
    const output = JSON.parse(toolText(outputResponse)) as { state: string; output: string };
    assert.equal(output.state, "exited");
    assert.match(output.output, /cross-request-ok/);
  } finally {
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("refuses non-loopback HTTP bind hosts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wincode-http-bind-"));
  try {
    const runtime = await createWinCodeRuntime(configFor(root));
    await assert.rejects(
      () => startWinCodeHttpServer(runtime, { host: "0.0.0.0", port: 0 }),
      /loopback only/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
