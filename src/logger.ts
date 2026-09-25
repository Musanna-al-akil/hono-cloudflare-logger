import {
  resolveLevelPriority,
  resolveOutput,
  type OutputOptions,
  type ResolvedOutput,
} from "./config.ts";
import { DEFAULT_LEVEL } from "./levels.ts";
import { sanitize } from "./sanitize.ts";
import { reportWriteFailure } from "./sink.ts";
import { isoTimestamp } from "./time.ts";
import type { LogContext, LogEntry, RequestMetadata, SyslogLevel } from "./types.ts";

export type DataPlacement = "trace" | "flat";

export interface LogWriteOptions {
  dataPlacement?: DataPlacement;
}

export interface LoggerOptions extends OutputOptions {
  /** Minimum log level to emit. Default: `info`. */
  level?: SyslogLevel;
  /** Correlation id added to every entry as `trace_id`. */
  traceId?: string;
}

/** Request-scoped fields shared by every entry. Built once and already sanitized. */
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
  readonly output: ResolvedOutput;
  readonly buildBase: ((input: Input, output: ResolvedOutput) => BaseFields) | undefined;
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
  const base = core.buildBase ? core.buildBase(core.baseInput, core.output) : {};
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
        minPriority: resolveLevelPriority(options.level, DEFAULT_LEVEL),
        output: resolveOutput(options),
        buildBase: undefined,
        baseInput: undefined,
        base,
      };
    }

    this.context = undefined;
  }

  setContext(context: LogContext): void {
    const sanitized = sanitize(context, this.core.output.sanitize);
    this.context ??= {};
    assignSafe(this.context, sanitized);
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

    let entry: LogEntry | undefined;
    try {
      const output = core.output;
      entry = { level, msg };
      if (data && dataPlacement === "trace") {
        entry.trace = sanitize(data, output.sanitize);
      }
      if (output.timestamp) {
        entry.time = isoTimestamp();
      }

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
        assignSafe(entry, sanitize(data, output.sanitize));
      }

      if (err instanceof Error) {
        const errEntry: LogEntry["err"] = { message: err.message };
        if (err.stack) {
          errEntry.stack = err.stack;
        }

        entry.err = errEntry;
      }

      output.write(entry, levelPriority);
    } catch (error) {
      reportWriteFailure(entry, error);
    }
  }
}

/** @internal Creates a logger bound to an existing core. */
export function createLoggerFromCore<Input>(core: LoggerCore<Input>): Logger {
  return new Logger({ [CORE]: core as LoggerCore } as LoggerOptions);
}
