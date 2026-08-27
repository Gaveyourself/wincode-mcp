import { loadConfig } from "./config.js";
import { startWinCodeHttpServer } from "./http-server.js";
import { createWinCodeRuntime } from "./runtime/runtime.js";

function parsePort(raw: string | undefined): number {
  if (!raw) return 48371;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid WINCODE_HTTP_PORT: ${raw}`);
  }
  return value;
}

const config = loadConfig();
const runtime = await createWinCodeRuntime(config);
const host = process.env.WINCODE_HTTP_HOST ?? "127.0.0.1";
const port = parsePort(process.env.WINCODE_HTTP_PORT);
const running = await startWinCodeHttpServer(runtime, { host, port });

console.error(`[wincode-mcp] v0.3.0 http | mcp=http://${running.host}:${running.port}/mcp | health=http://${running.host}:${running.port}/health | workspace=${config.workspace} | commands=${process.env.WINCODE_ALLOW_COMMANDS === "1" ? "enabled" : "disabled"} | audit=${config.auditEnabled ? "enabled" : "disabled"}`);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.error(`[wincode-mcp] shutting down on ${signal}`);
  try {
    await running.close();
    process.exitCode = 0;
  } catch (error) {
    console.error(`[wincode-mcp] shutdown error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
