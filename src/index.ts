import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "./config.js";
import { createWinCodeRuntime } from "./runtime/runtime.js";
import { createWinCodeServer } from "./server.js";

const config = loadConfig();
const runtime = await createWinCodeRuntime(config);
const server = createWinCodeServer(runtime);

void serveStdio(() => server);
console.error(`[wincode-mcp] v0.3.0 stdio | workspace=${config.workspace} | commands=${process.env.WINCODE_ALLOW_COMMANDS === "1" ? "enabled" : "disabled"} | audit=${config.auditEnabled ? "enabled" : "disabled"}`);
