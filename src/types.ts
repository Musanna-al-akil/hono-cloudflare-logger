import type { Context, Env } from "hono";
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

/** Structured fields attached to an entry or to the logger context. */
export type LogData = Record<string, unknown>;

/** @deprecated Use {@link LogData}. */
export type LogContext = LogData;

/** Where per-call data goes: nested under `data` (default) or merged into the entry. */
export type DataPlacement = "nested" | "flat";

export interface LogWriteOptions {
  placement?: DataPlacement;
}

/**
 * Commonly logged keys of Cloudflare's `request.cf` object
 * (`IncomingRequestCfProperties`). Any other key is accepted too.
 */
export type CfPropertyKey =
  | "asn"
  | "asOrganization"
  | "botManagement"
  | "city"
  | "clientAcceptEncoding"
  | "clientTcpRtt"
  | "colo"
  | "continent"
  | "country"
  | "httpProtocol"
  | "isEUCountry"
  | "latitude"
  | "longitude"
  | "metroCode"
  | "postalCode"
  | "region"
  | "regionCode"
  | "requestPriority"
  | "timezone"
  | "tlsCipher"
  | "tlsVersion"
  | "verifiedBotCategory"
  | (string & {});

export interface RequestMetadata {
  method: string;
  /** Request path, e.g. `/users/42`. */
  path: string;
  /** Matched route pattern, e.g. `/users/:id`. Low-cardinality, good for grouping. */
  route?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  cf?: Record<string, unknown>;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  status?: number;
  cause?: unknown;
  errors?: SerializedError[];
}

/** @deprecated Use {@link SerializedError}. */
export type ErrorMetadata = SerializedError;

export interface LogEntry {
  level: SyslogLevel;
  msg: string;
  time?: string;
  trace_id?: string;
  data?: LogData;
  err?: SerializedError;
  req?: RequestMetadata;
  [key: string]: unknown;
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

/**
 * Resolves the minimum level per request, e.g. from an environment binding:
 * `(c) => c.env.LOG_LEVEL`. Unknown values fall back to `info`.
 */
export type LevelResolver<E extends Env = any> = (c: Context<E>) => string | undefined;

export interface LoggerConfig<E extends Env = any> {
  /**
   * Minimum log level to emit, or a function resolving it per request (called
   * at most once, on the first log call). Default: `info`.
   */
  level?: SyslogLevel | LevelResolver<E>;
  /** Output format. Default: `object`. */
  format?: LogFormat;
  /** Custom destination for entries. Overrides `format`. */
  sink?: LogSink | LogSinkObject;
  /** Add an ISO-8601 `time` field. Workers Logs also timestamps every event. Default: `true`. */
  timestamp?: boolean;
  /**
   * Header read for `trace_id`, or `false` to skip it. The id set by Hono's
   * `requestId()` middleware wins; then this header, the W3C `traceparent`
   * trace-id, `cf-ray`, and finally a generated id. Default: `x-request-id`.
   */
  traceHeader?: string | false;
  /** Use the trace-id of a W3C `traceparent` header. Default: `true`. */
  traceparent?: boolean;
  /**
   * Generates a trace id when no header provides one, or `false` to omit
   * `trace_id`. Default: `crypto.randomUUID`.
   */
  generateTraceId?: false | (() => string);
  /**
   * Response header that echoes the trace id (e.g. `x-request-id`), or
   * `false`. An existing header on the response is left untouched. Default: `false`.
   */
  responseHeader?: string | false;
  /**
   * Automatic entry when the response is ready. `access`: one entry per
   * request, `info` for 2xx/3xx, `warning` for 4xx, `error` for 5xx or thrown
   * errors. `error`: only the `error` ones. Default: `silent`.
   */
  autoLogging?: AutoLoggingMode;
  /**
   * Fraction (0-1) of successful `info` access entries to keep. Warnings and
   * errors are always kept. Default: `1`.
   */
  sampleRate?: number;
  /** Return `true` to suppress the automatic entry, e.g. for health checks. */
  skip?: (c: Context<E>) => boolean;
  /**
   * Hold `debug`/`info`/`notice` entries in memory and write them only if the
   * request fails (a 5xx, a thrown error, or an `error`-level entry);
   * otherwise drop them. Keeps full context for failures while cutting
   * Workers Logs volume for successful requests. Default: `false`.
   */
  bufferUntilError?: boolean;
  /** Cloudflare `request.cf` keys to include under `req.cf`. Default: `[]`. */
  includeCfProperties?: readonly CfPropertyKey[];
  /**
   * Include request headers under `req.headers`: `true` for all, or an
   * allowlist. Credential headers are always censored. Default: `false`.
   */
  header?: boolean | readonly string[];
  /** Include query parameters under `req.query` (redacted like any data). Default: `false`. */
  query?: boolean;
  /** Keys to redact recursively; matching ignores case and `-`, `_`, `.` separators. Default: `[]`. */
  redactKeys?: readonly string[];
  /** Replacement for redacted values. Default: `[REDACTED]`. */
  censor?: string;
  /** Longer strings are truncated to keep entries under the Workers Logs size limit. Default: `8192`. */
  maxStringLength?: number;
}

export interface LoggerVariables {
  logger: Logger;
}
