import { isErrorLevel } from "./levels";
import type { LogEntry } from "./types";

const FALLBACK_LINE = '{"level":"error","msg":"Logger failed to serialize object"}\n';

export function writeLogEntry(entry: LogEntry): void {
  try {
    const line = `${JSON.stringify(entry)}\n`;
    if (isErrorLevel(entry.level)) {
      console.error(line);
      return;
    }
    console.log(line);
  } catch {
    console.error(FALLBACK_LINE);
    return;
  }
}
