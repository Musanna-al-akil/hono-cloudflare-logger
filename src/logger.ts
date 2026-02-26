import { DEFAULT_LEVEL, getLevelPriority, shouldLogPriority } from "./levels";
import { redactDeep } from "./redact";
import { writeLogEntry } from "./serialize";
import type { LogContext, LogEntry, RequestMetadata, SyslogLevel } from "./types";

export type DataPlacement = "trace" | "flat";

export interface LogWriteOptions {
  dataPlacement?: DataPlacement;
}

export interface LoggerOptions {
  level?: SyslogLevel;
  traceId?: string;
  req?: RequestMetadata;
  redactKeys?: readonly string[];
}

function isReservedKey(key: string): boolean {
  return key === "level" || key === "msg" || key === "time" || key === "trace";
}

function assignSafe(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key in source) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    if (isReservedKey(key)) {
      continue;
    }

    target[key] = source[key];
  }
}

export class Logger {
  private readonly minLevelPriority: number;
  private readonly baseData: Omit<LogEntry, "level" | "time" | "msg">;
  private readonly redactKeys: ReadonlySet<string>;
  private context: LogContext = {};

  constructor(options: LoggerOptions = {}) {
    const level = options.level ?? DEFAULT_LEVEL;
    this.minLevelPriority = getLevelPriority(level);
    this.baseData = {};
    this.redactKeys = new Set((options.redactKeys ?? []).map((key) => key.toLowerCase()));

    if (options.traceId) {
      this.baseData.trace_id = options.traceId;
    }

    if (options.req) {
      this.baseData.req = options.req;
    }
  }

  setContext(context: LogContext): void {
    Object.assign(this.context, context);
  }

  debug(msg: string, data?: LogContext, options?: LogWriteOptions): void {
    this.write("debug", 0, msg, data, undefined, options?.dataPlacement);
  }

  info(msg: string, data?: LogContext, options?: LogWriteOptions): void {
    this.write("info", 1, msg, data, undefined, options?.dataPlacement);
  }

  notice(msg: string, data?: LogContext, options?: LogWriteOptions): void {
    this.write("notice", 2, msg, data, undefined, options?.dataPlacement);
  }

  warning(msg: string, data?: LogContext, options?: LogWriteOptions): void {
    this.write("warning", 3, msg, data, undefined, options?.dataPlacement);
  }

  error(msg: string, err?: Error, data?: LogContext, options?: LogWriteOptions): void {
    this.write("error", 4, msg, data, err, options?.dataPlacement);
  }

  critical(msg: string, err?: Error, data?: LogContext, options?: LogWriteOptions): void {
    this.write("critical", 5, msg, data, err, options?.dataPlacement);
  }

  alert(msg: string, err?: Error, data?: LogContext, options?: LogWriteOptions): void {
    this.write("alert", 6, msg, data, err, options?.dataPlacement);
  }

  emergency(msg: string, err?: Error, data?: LogContext, options?: LogWriteOptions): void {
    this.write("emergency", 7, msg, data, err, options?.dataPlacement);
  }

  private write(
    level: SyslogLevel,
    levelPriority: number,
    msg: string,
    data?: LogContext,
    err?: Error,
    dataPlacement: DataPlacement = "trace",
  ): void {
    if (!shouldLogPriority(levelPriority, this.minLevelPriority)) {
      return;
    }

    const entry: LogEntry = {
      level,
      msg,
    };
    if (data && dataPlacement === "trace") {
      entry.trace = data;
    }
    entry.time = new Date().toISOString();

    assignSafe(entry, this.baseData as Record<string, unknown>);
    assignSafe(entry, this.context);

    if (data && dataPlacement === "flat") {
      assignSafe(entry, data);
    }

    if (err instanceof Error) {
      const errEntry: LogEntry["err"] = { message: err.message };
      if (err.stack) {
        errEntry.stack = err.stack;
      }

      entry.err = errEntry;
    }

    const redacted = redactDeep(entry, this.redactKeys);
    writeLogEntry(redacted);
  }
}
