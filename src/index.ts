import type { Logger } from "./logger.ts";

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

declare module "hono" {
  interface ContextVariableMap {
    /** Request-scoped logger set by the `logger()` middleware. */
    logger: Logger;
  }
}
