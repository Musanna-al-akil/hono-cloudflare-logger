import { CONSOLE_METHOD_BY_PRIORITY } from "./levels.ts";
import type { LogEntry, LogFormat, LogSink, LogSinkObject } from "./types.ts";

export type EntryWriter = (entry: LogEntry, priority: number) => void;

const FAILURE_MSG = "Logger failed to write entry";
// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARS = /\p{Cc}/gu;

/** Last-resort output used when an entry cannot be serialized or a sink throws. */
export function reportWriteFailure(entry: Partial<LogEntry> | undefined, error: unknown): void {
  try {
    console.error(
      JSON.stringify({
        level: "error",
        msg: FAILURE_MSG,
        original_level: entry?.level,
        original_msg: typeof entry?.msg === "string" ? entry.msg.slice(0, 1024) : undefined,
        trace_id: entry?.trace_id,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  } catch {
    // Nothing left to do: logging must never throw into the application.
  }
}

function escapeControlChars(value: string): string {
  return value.replace(
    CONTROL_CHARS,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Formats an entry as one human-readable line for local development. */
export function formatPretty(entry: LogEntry): string {
  const time = typeof entry.time === "string" ? `${entry.time.slice(11, 23)} ` : "";
  let line = `${time}${entry.level.toUpperCase().padEnd(9)} ${escapeControlChars(entry.msg)}`;

  for (const key in entry) {
    if (key === "level" || key === "msg" || key === "time") {
      continue;
    }

    const value = entry[key];
    if (value !== undefined) {
      line += ` ${key}=${JSON.stringify(value)}`;
    }
  }

  return line;
}

function writeToConsole(method: (typeof CONSOLE_METHOD_BY_PRIORITY)[number], value: unknown): void {
  // Look the method up on every call so runtime or test instrumentation is respected.
  console[method](value);
}

/** Creates the function that delivers a finished entry to its destination. */
export function createWriter(
  format: LogFormat,
  sink: LogSink | LogSinkObject | undefined,
): EntryWriter {
  if (sink) {
    const write = typeof sink === "function" ? sink : sink.write.bind(sink);
    return (entry, priority) => {
      try {
        write(entry, { level: entry.level, priority });
      } catch (error) {
        reportWriteFailure(entry, error);
      }
    };
  }

  if (format === "json") {
    return (entry, priority) => {
      let line: string;
      try {
        line = JSON.stringify(entry);
      } catch (error) {
        reportWriteFailure(entry, error);
        return;
      }
      writeToConsole(CONSOLE_METHOD_BY_PRIORITY[priority] ?? "error", line);
    };
  }

  if (format === "pretty") {
    return (entry, priority) => {
      writeToConsole(CONSOLE_METHOD_BY_PRIORITY[priority] ?? "error", formatPretty(entry));
    };
  }

  return (entry, priority) => {
    writeToConsole(CONSOLE_METHOD_BY_PRIORITY[priority] ?? "error", entry);
  };
}
