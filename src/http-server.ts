import { createServer, Server as NodeHttpServer } from "node:http";

import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";

import { WinCodeRuntime } from "./runtime/runtime.js";
import { createWinCodeServer } from "./server.js";

export interface WinCodeHttpOptions {
  host?: string;
  port?: number;
}

export interface RunningWinCodeHttpServer {
  host: string;
  port: number;
  server: NodeHttpServer;
  close: () => Promise<void>;
}

function assertLoopbackHost(host: string): void {
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(host)) {
    throw new Error(`WinCode HTTP must bind to loopback only; refused host: ${host}`);
  }
}

function requestPath(rawUrl: string | undefined): string {
  const value = rawUrl ?? "/";
  const query = value.indexOf("?");
  return query === -1 ? value : value.slice(0, query);
}

export async function startWinCodeHttpServer(
  runtime: WinCodeRuntime,
  options: WinCodeHttpOptions = {},
): Promise<RunningWinCodeHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 48371;
  assertLoopbackHost(host);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error(`Invalid HTTP port: ${requestedPort}`);
  }

  // createMcpHandler creates fresh protocol server instances per request. They
  // all close over the same runtime, preserving managed command IDs and other
  // long-lived local state across HTTP requests.
  const handler = createMcpHandler(() => createWinCodeServer(runtime), {
    onerror: error => console.error(`[wincode-mcp:http] MCP error: ${error.message}`),
  });
  const nodeMcpHandler = toNodeHandler(handler, {
    onerror: error => console.error(`[wincode-mcp:http] adapter error: ${error.message}`),
  });
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const server = createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    const pathname = requestPath(req.url);

    if (pathname === "/health" || pathname === "/healthz" || pathname === "/readyz") {
      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "application/json", Allow: "GET" });
        res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({
        ok: true,
        ready: true,
        name: "wincode-mcp",
        version: "0.3.0",
        transport: "http",
        platform: process.platform,
        node: process.version,
        workspace: runtime.guard.canonicalRoot,
        commandsEnabled: runtime.commandsEnabled,
        auditEnabled: runtime.config.auditEnabled,
      }));
      return;
    }

    if (pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    void nodeMcpHandler(req, res).catch(error => {
      console.error(`[wincode-mcp:http] request error: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: "internal_error" }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(requestedPort, host);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    await handler.close();
    throw new Error("Unable to determine WinCode HTTP listen address");
  }

  let closed = false;
  return {
    host,
    port: address.port,
    server,
    close: async () => {
      if (closed) return;
      closed = true;
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    },
  };
}
