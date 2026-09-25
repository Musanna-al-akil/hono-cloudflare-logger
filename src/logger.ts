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

/**
 * State shared by a logger and its children for one request (or one
 * standalone logger). The trace id and request metadata are resolved lazily,
 * so requests that never log pay almost nothing. When `requestVersion`
 * changes (Hono moved on to the route handler), request metadata is rebuilt
 * so fields such as `req.route` stay accurate.
 *
 * @internal
 */
export interface LoggerCore<Input = unknown> {
  readonly minPriority: number;
  readonly output: ResolvedOutput;
  readonly input: Input;
  readonly resolveTraceId: ((input: Input) => string | undefined) | undefined;
  readonly buildRequest: ((input: Input, output: ResolvedOutput) => RequestMetadata) | undefined;
  readonly requestVersion: ((input: Input) => number) | undefined;
  traceId: string | undefined;
  traceResolved: boolean;
  req: RequestMetadata | undefined;
  reqStamp: number;
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

function currentTraceId(core: LoggerCore): string | undefined {
  if (!core.traceResolved) {
    core.traceId = core.resolveTraceId ? core.resolveTraceId(core.input) : undefined;
    core.traceResolved = true;
  }
  return core.traceId;
}

function currentRequest(core: LoggerCore): RequestMetadata | undefined {
  if (!core.buildRequest) {
    return undefined;
  }

  const version = core.requestVersion ? core.requestVersion(core.input) : 0;
  if (core.req === undefined || version !== core.reqStamp) {
    core.req = core.buildRequest(core.input, core.output);
    core.reqStamp = version;
  }
  return core.req;
}

export class Logger {
  private readonly core: LoggerCore;
  private context: LogData | undefined;

  constructor(options?: LoggerOptions);
  constructor(options: LoggerOptions | InternalInit = {}) {
    if (CORE in options) {
      this.core = options[CORE];
    } else {
      this.core = {
        minPriority: resolveLevelPriority(options.level, DEFAULT_LEVEL),
        output: resolveOutput(options),
        input: undefined,
        resolveTraceId: undefined,
        buildRequest: undefined,
        requestVersion: undefined,
        traceId: options.traceId || undefined,
        traceResolved: true,
        req: undefined,
        reqStamp: 0,
      };
    }

    this.context = undefined;
  }

  /** Correlation id of this request (or the one given to a standalone logger). */
  get traceId(): string | undefined {
    return currentTraceId(this.core);
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

      const traceId = currentTraceId(core);
      if (traceId !== undefined) {
        entry.trace_id = traceId;
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

      const req = currentRequest(core);
      if (req !== undefined) {
        entry.req = req;
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
