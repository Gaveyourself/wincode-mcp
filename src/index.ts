import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "./config.js";
import { createWinCodeServer } from "./server.js";

const config = loadConfig();
const server = await createWinCodeServer(config);

void serveStdio(() => server);
console.error(`[wincode-mcp] v0.1.0 stdio | workspace=${config.workspace} | commands=${process.env.WINCODE_ALLOW_COMMANDS === "1" ? "enabled" : "disabled"}`);
