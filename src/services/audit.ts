import { promises as fs } from "node:fs";
import path from "node:path";

export interface AuditEvent {
  action: string;
  details?: Record<string, unknown>;
}

export class AuditLogger {
  private readonly logPath: string;

  constructor(workspaceRoot: string, private readonly enabled = true) {
    this.logPath = path.join(workspaceRoot, ".wincode", "audit.jsonl");
  }

  async record(event: AuditEvent): Promise<void> {
    if (!this.enabled) return;
    try {
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
      const line = JSON.stringify({
        time: new Date().toISOString(),
        action: event.action,
        details: event.details ?? {},
      });
      await fs.appendFile(this.logPath, `${line}\n`, "utf8");
    } catch (error) {
      console.error(`[wincode-mcp] audit write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
