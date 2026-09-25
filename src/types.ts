import type { Logger } from "./logger.ts";

export type SyslogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

export type AutoLoggingMode = "silent" | "access" | "error";

/**
 * How entries are written.
 *
 * - `object`: the entry object is passed to `console.*`. Workers Logs indexes
 *   its fields, and the isolate skips `JSON.stringify`.
 * - `json`: one JSON string per entry, for NDJSON consumers.
 * - `pretty`: one human-readable line, for local development.
 */
export type LogFormat = "object" | "json" | "pretty";

export type LogContext = Record<string, any>;

export interface RequestMetadata {
  method: string;
  url: string;
  headers?: Record<string, string>;
  cf?: Record<string, unknown>;
}

export interface ErrorMetadata {
  message: string;
  stack?: string;
}

export interface LogEntry extends Record<string, any> {
  level: SyslogLevel;
  time?: string;
  trace_id?: string;
  msg: string;
  trace?: LogContext;
  req?: RequestMetadata;
  err?: ErrorMetadata;
}

export interface LogSinkInfo {
  level: SyslogLevel;
  /** Numeric severity, 0 (`debug`) to 7 (`emergency`). */
  priority: number;
}

/** Receives every finished entry instead of the console. Must not throw. */
export type LogSink = (entry: LogEntry, info: LogSinkInfo) => void;

export interface LogSinkObject {
  write: LogSink;
  /**
   * Called once per request after the response is ready, through
   * `executionCtx.waitUntil()` when available. Use it to ship batched entries.
   */
  flush?: () => Promise<void>;
}

export interface LoggerConfig {
  /** Minimum log level to emit. Default: `info`. */
  level?: SyslogLevel;
  /** Output format. Default: `object`. */
  format?: LogFormat;
  /** Custom destination for entries. Overrides `format`. */
  sink?: LogSink | LogSinkObject;
  /** Add an ISO-8601 `time` field. Workers Logs also timestamps every event. Default: `true`. */
  timestamp?: boolean;
  /** Primary header used to extract `trace_id`. Falls back to `cf-ray`. Default: `X-Request-Id`. */
  traceHeader?: string;
  /** Automatic request logging mode. Default: `silent`. */
  autoLogging?: AutoLoggingMode;
  /** Cloudflare `c.req.raw.cf` keys to include under `req.cf`. Default: `[]`. */
  includeCfProperties?: readonly string[];
  /** Keys to redact recursively and case-insensitively. Default: `[]`. */
  redactKeys?: readonly string[];
  /** Replacement for redacted values. Default: `[REDACTED]`. */
  censor?: string;
  /** Longer strings are truncated to keep entries under the Workers Logs size limit. Default: `8192`. */
  maxStringLength?: number;
  /** Include request headers under `req.headers`. Default: `false`. */
  header?: boolean | readonly string[];
}

export interface LoggerVariables {
  logger: Logger;
}
