/**
 * Structured logging middleware for Hono on Cloudflare Workers.
 *
 * This is the JSR entry. JSR doesn't allow module augmentation, so type
 * `c.var.logger` with `new Hono<{ Variables: LoggerVariables }>()`. The npm
 * entry (`index.ts`) adds a `ContextVariableMap` augmentation that makes the
 * generic unnecessary.
 *
 * @module
 */
export { createLogger, Logger, type LoggerOptions } from "./logger.ts";
export { logger } from "./middleware.ts";
export type {
  AutoLoggingMode,
  CfPropertyKey,
  DataPlacement,
  ErrorMetadata,
  LevelResolver,
  LogContext,
  LogData,
  LogEntry,
  LogFormat,
  LoggerConfig,
  LoggerVariables,
  LogSink,
  LogSinkInfo,
  LogSinkObject,
  LogWriteOptions,
  RequestMetadata,
  SerializedError,
  SyslogLevel,
} from "./types.ts";
