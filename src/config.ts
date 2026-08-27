import path from "node:path";

export interface WinCodeConfig {
  workspace: string;
  maxReadBytes: number;
  maxWriteBytes: number;
  maxSearchResults: number;
  commandOutputBytes: number;
  gitOutputBytes: number;
  auditEnabled: boolean;
}

const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 1024 * 1024;
const DEFAULT_MAX_SEARCH_RESULTS = 200;
const DEFAULT_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WinCodeConfig {
  return {
    workspace: path.resolve(env.WINCODE_WORKSPACE ?? process.cwd()),
    maxReadBytes: parsePositiveInt(env.WINCODE_MAX_READ_BYTES, DEFAULT_MAX_READ_BYTES),
    maxWriteBytes: parsePositiveInt(env.WINCODE_MAX_WRITE_BYTES, DEFAULT_MAX_WRITE_BYTES),
    maxSearchResults: parsePositiveInt(env.WINCODE_MAX_SEARCH_RESULTS, DEFAULT_MAX_SEARCH_RESULTS),
    commandOutputBytes: parsePositiveInt(env.WINCODE_COMMAND_OUTPUT_BYTES, DEFAULT_COMMAND_OUTPUT_BYTES),
    gitOutputBytes: parsePositiveInt(env.WINCODE_GIT_OUTPUT_BYTES, DEFAULT_GIT_OUTPUT_BYTES),
    auditEnabled: env.WINCODE_AUDIT !== "0",
  };
}
