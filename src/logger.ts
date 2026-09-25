import { DEFAULT_LEVEL, getLevelPriority } from "./levels.ts";
import { createKeyMatcher, redactDeep, type KeyMatcher } from "./redact.ts";
import { writeLogEntry } from "./serialize.ts";
import type { LogContext, LogEntry, RequestMetadata, SyslogLevel } from "./types.ts";

export type DataPlacement = "trace" | "flat";

export interface LogWriteOptions {
  dataPlacement?: DataPlacement;
}

export interface LoggerOptions {
  level?: SyslogLevel;
  traceId?: string;
  redactKeys?: readonly string[];
}

/** Request-scoped fields shared by every entry. Built once and already redacted. */
export interface BaseFields {
  trace_id?: string;
  req?: RequestMetadata;
}

/**
 * State shared by a logger and its children for one request (or one
 * standalone logger). Base fields are produced lazily by `buildBase` on the
 * first emitted entry, so requests that never log pay almost nothing.
 *
 * @internal
 */
export interface LoggerCore<Input = unknown> {
  readonly minPriority: number;
  readonly matcher: KeyMatcher | undefined;
  readonly buildBase: ((input: Input, matcher: KeyMatcher | undefined) => BaseFields) | undefined;
  readonly baseInput: Input;
  base: BaseFields | undefined;
}

const CORE = Symbol("hono-cloudflare-logger.core");

interface InternalInit {
  readonly [CORE]: LoggerCore;
}

function isReservedKey(key: string): boolean {
  return key === "level" || key === "msg" || key === "time" || key === "trace";
}

function assignSafe(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key in source) {
    if (!Object.hasOwn(source, key) || isReservedKey(key)) {
      continue;
    }

    target[key] = source[key];
  }
}

function resolveBase(core: LoggerCore): BaseFields {
  const base = core.buildBase ? core.buildBase(core.baseInput, core.matcher) : {};
  core.base = base;
  return base;
}

export class Logger {
  private readonly core: LoggerCore;
  private context: LogContext | undefined;

  constructor(options?: LoggerOptions);
  constructor(options: LoggerOptions | InternalInit = {}) {
    if (CORE in options) {
      this.core = options[CORE];
    } else {
      const base: BaseFields = {};
      if (options.traceId) {
        base.trace_id = options.traceId;
      }

      this.core = {
        minPriority: getLevelPriority(options.level ?? DEFAULT_LEVEL),
        matcher: createKeyMatcher(options.redactKeys ?? []),
        buildBase: undefined,
        baseInput: undefined,
        base,
      };
    }

    this.context = undefined;
  }

  setContext(context: LogContext): void {
    const redacted = redactDeep(context, this.core.matcher);
    this.context ??= {};
    assignSafe(this.context, redacted);
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
    const core = this.core;
    if (levelPriority < core.minPriority) {
      return;
    }

    const entry: LogEntry = {
      level,
      msg,
    };
    if (data && dataPlacement === "trace") {
      entry.trace = redactDeep(data, core.matcher);
    }
    entry.time = new Date().toISOString();

    const base = core.base ?? resolveBase(core);
    if (base.trace_id) {
      entry.trace_id = base.trace_id;
    }
    if (base.req) {
      entry.req = base.req;
    }

    if (this.context) {
      assignSafe(entry, this.context);
    }

    if (data && dataPlacement === "flat") {
      assignSafe(entry, redactDeep(data, core.matcher));
    }

    if (err instanceof Error) {
      const errEntry: LogEntry["err"] = { message: err.message };
      if (err.stack) {
        errEntry.stack = err.stack;
      }

      entry.err = errEntry;
    }

    writeLogEntry(entry, levelPriority);
  }
}

/** @internal Creates a logger bound to an existing core. */
export function createLoggerFromCore<Input>(core: LoggerCore<Input>): Logger {
  return new Logger({ [CORE]: core as LoggerCore } as LoggerOptions);
}
