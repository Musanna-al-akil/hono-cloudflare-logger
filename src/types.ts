import type { Logger } from "./logger";

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

export interface LoggerConfig {
  /** Minimum log level to emit. Default: `info`. */
  level?: SyslogLevel;
  /** Primary header used to extract `trace_id`. Falls back to `cf-ray`. Default: `X-Request-Id`. */
  traceHeader?: string;
  /** Automatic request logging mode. Default: `silent`. */
  autoLogging?: AutoLoggingMode;
  /** Cloudflare `c.req.raw.cf` keys to include under `req.cf`. Default: `[]`. */
  includeCfProperties?: readonly string[];
  /** Keys to redact recursively and case-insensitively. Default: `[]`. */
  redactKeys?: readonly string[];
  /** Include request headers under `req.headers`. Default: `false`. */
  header?: boolean | readonly string[];
}

export interface LoggerVariables {
  logger: Logger;
}
