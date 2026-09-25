import {
  resolveLevelPriority,
  resolveOutput,
  type OutputOptions,
  type ResolvedOutput,
} from "./config.ts";
import { DEFAULT_LEVEL, SYSLOG_LEVELS } from "./levels.ts";
import { sanitize, serializeErrorValue } from "./sanitize.ts";
import { reportWriteFailure } from "./sink.ts";
import { isoTimestamp } from "./time.ts";
import type { LogData, LogEntry, LogWriteOptions, RequestMetadata, SyslogLevel } from "./types.ts";

export interface LoggerOptions extends OutputOptions {
  /** Minimum log level to emit. Default: `info`. */
  level?: SyslogLevel;
  /** Correlation id added to every entry as `trace_id`. */
  traceId?: string;
}

/** Request-scoped fields shared by every entry. Built lazily and already sanitized. */
export interface BaseFields {
  trace_id?: string;
  req?: RequestMetadata;
}

/**
 * State shared by a logger and its children for one request (or one
 * standalone logger). Base fields are produced lazily by `buildBase` on the
 * first emitted entry, so requests that never log pay almost nothing. When
 * `baseVersion` changes (e.g. Hono moved on to the route handler), the base
 * is rebuilt so fields such as `req.route` stay accurate.
 *
 * @internal
 */
export interface LoggerCore<Input = unknown> {
  readonly minPriority: number;
  readonly output: ResolvedOutput;
  readonly buildBase: ((input: Input, output: ResolvedOutput) => BaseFields) | undefined;
  readonly baseVersion: ((input: Input) => number) | undefined;
  readonly baseInput: Input;
  base: BaseFields | undefined;
  baseStamp: number;
}

const CORE = Symbol("hono-cloudflare-logger.core");

interface InternalInit {
  readonly [CORE]: LoggerCore;
}

function isReservedKey(key: string): boolean {
  switch (key) {
    case "level":
    case "msg":
    case "time":
    case "trace_id":
    case "data":
    case "err":
    case "req":
      return true;
    default:
      return false;
  }
}

function assignSafe(target: Record<string, unknown>, source: LogData): void {
  for (const key of Object.keys(source)) {
    if (!isReservedKey(key)) {
      target[key] = source[key];
    }
  }
}

function currentBase(core: LoggerCore): BaseFields {
  const version = core.baseVersion ? core.baseVersion(core.baseInput) : 0;
  if (core.base === undefined || version !== core.baseStamp) {
    core.base = core.buildBase ? core.buildBase(core.baseInput, core.output) : {};
    core.baseStamp = version;
  }
  return core.base;
}

export class Logger {
  private readonly core: LoggerCore;
  private context: LogData | undefined;

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
        minPriority: resolveLevelPriority(options.level, DEFAULT_LEVEL),
        output: resolveOutput(options),
        buildBase: undefined,
        baseVersion: undefined,
        baseInput: undefined,
        base,
        baseStamp: 0,
      };
    }

    this.context = undefined;
  }

  /** Merges fields into every later entry from this logger. Reserved keys are ignored. */
  setContext(context: LogData): void {
    const sanitized = sanitize(context, this.core.output.sanitize);
    this.context ??= {};
    assignSafe(this.context, sanitized);
  }

  debug(msg: string, data?: LogData, options?: LogWriteOptions): void {
    this.write(0, msg, data, undefined, options);
  }

  info(msg: string, data?: LogData, options?: LogWriteOptions): void {
    this.write(1, msg, data, undefined, options);
  }

  notice(msg: string, data?: LogData, options?: LogWriteOptions): void {
    this.write(2, msg, data, undefined, options);
  }

  warning(msg: string, data?: LogData, options?: LogWriteOptions): void {
    this.write(3, msg, data, undefined, options);
  }

  /** `err` accepts anything that can be thrown, so `catch (error)` values work as-is. */
  error(msg: string, err?: unknown, data?: LogData, options?: LogWriteOptions): void {
    this.write(4, msg, data, err, options);
  }

  critical(msg: string, err?: unknown, data?: LogData, options?: LogWriteOptions): void {
    this.write(5, msg, data, err, options);
  }

  alert(msg: string, err?: unknown, data?: LogData, options?: LogWriteOptions): void {
    this.write(6, msg, data, err, options);
  }

  emergency(msg: string, err?: unknown, data?: LogData, options?: LogWriteOptions): void {
    this.write(7, msg, data, err, options);
  }

  private write(
    priority: number,
    msg: string,
    data: LogData | undefined,
    err: unknown,
    options: LogWriteOptions | undefined,
  ): void {
    const core = this.core;
    if (priority < core.minPriority) {
      return;
    }

    let entry: LogEntry | undefined;
    try {
      const output = core.output;
      entry = {
        level: SYSLOG_LEVELS[priority] as SyslogLevel,
        msg: typeof msg === "string" ? msg : String(msg),
      };
      if (output.timestamp) {
        entry.time = isoTimestamp();
      }

      const base = currentBase(core);
      if (base.trace_id !== undefined) {
        entry.trace_id = base.trace_id;
      }

      if (this.context !== undefined) {
        assignSafe(entry, this.context);
      }

      if (data !== undefined) {
        const sanitized = sanitize(data, output.sanitize);
        if (options?.placement === "flat") {
          assignSafe(entry, sanitized);
        } else {
          entry.data = sanitized;
        }
      }

      if (err !== undefined) {
        entry.err = serializeErrorValue(err, output.sanitize);
      }

      if (base.req !== undefined) {
        entry.req = base.req;
      }

      output.write(entry, priority);
    } catch (error) {
      reportWriteFailure(entry, error);
    }
  }
}

/** @internal Creates a logger bound to an existing core. */
export function createLoggerFromCore<Input>(core: LoggerCore<Input>): Logger {
  return new Logger({ [CORE]: core as LoggerCore } as LoggerOptions);
}
