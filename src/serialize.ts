import { ERROR_LEVEL_PRIORITY } from "./levels.ts";
import type { LogEntry } from "./types.ts";

const FALLBACK_LINE = '{"level":"error","msg":"Logger failed to serialize object"}\n';

export function writeLogEntry(entry: LogEntry, levelPriority: number): void {
  try {
    const line = `${JSON.stringify(entry)}\n`;
    if (levelPriority >= ERROR_LEVEL_PRIORITY) {
      console.error(line);
      return;
    }
    console.log(line);
  } catch {
    console.error(FALLBACK_LINE);
  }
}
