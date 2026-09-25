# API reference

## Exports

```ts
// "hono-cloudflare-logger"
export { logger, createLogger, Logger };
export type {
  LoggerConfig,
  LoggerOptions,
  LevelResolver,
  SyslogLevel,
  LogFormat,
  AutoLoggingMode,
  LogData,
  LogWriteOptions,
  DataPlacement,
  LogEntry,
  SerializedError,
  RequestMetadata,
  CfPropertyKey,
  LogSink,
  LogSinkObject,
  LogSinkInfo,
  LoggerVariables,
  LogContext /* deprecated: LogData */,
  ErrorMetadata /* deprecated: SerializedError */,
};

// "hono-cloudflare-logger/context"
export { getLogger };
```

Importing the root entry also augments Hono's `ContextVariableMap`, so
`c.var.logger` and `c.get("logger")` are typed as `Logger` in every app with no
`Variables` generic. `LoggerVariables` is still exported for apps that list
their variables explicitly.

The JSR package doesn't include the augmentation, because JSR doesn't allow
packages to augment other modules. With JSR, type the app with
`new Hono<{ Variables: LoggerVariables }>()`.

## `logger(config?)`

```ts
function logger<E extends Env = any>(config?: LoggerConfig<E>): MiddlewareHandler<E>;
```

Creates the middleware that puts a request-scoped `Logger` on `c.var.logger`.
Pass your app's `Env` to type `c.env` in `level` and `skip`:

```ts
type AppEnv = { Bindings: { LOG_LEVEL?: string } };
app.use("*", logger<AppEnv>({ level: (c) => c.env.LOG_LEVEL }));
```

The middleware never swallows errors: Hono's `onError` still handles thrown
errors, and a non-Error throw is rethrown after it has been logged. See
[configuration](configuration.md) for every option.

## `createLogger(options?)`

```ts
function createLogger(options?: LoggerOptions): Logger;
```

A logger with no Hono context, for `scheduled`, `queue`, Durable Objects or
scripts. Options: `level`, `traceId`, `bindings`, `format`, `sink`, `timestamp`,
`redactKeys`, `censor`, `maxStringLength`. `new Logger(options)` does the same.

## `getLogger()`

```ts
import { getLogger } from "hono-cloudflare-logger/context";
function getLogger(): Logger;
```

Returns the current request's logger from anywhere in the request's async call
tree, with no need to pass `c` around. It requires Hono's
[`contextStorage()`](https://hono.dev/docs/middleware/builtin/context-storage)
middleware on the same routes, and the `nodejs_compat` (or
`nodejs_als`) compatibility flag. Outside a request it returns a shared default
logger (`info` level, object format). It lives in its own entry point so the
main entry never depends on `AsyncLocalStorage`.

## `class Logger`

```ts
debug(msg: string, data?: LogData, options?: LogWriteOptions): void;
info(msg: string, data?: LogData, options?: LogWriteOptions): void;
notice(msg: string, data?: LogData, options?: LogWriteOptions): void;
warning(msg: string, data?: LogData, options?: LogWriteOptions): void;

error(msg: string, err?: unknown, data?: LogData, options?: LogWriteOptions): void;
critical(msg: string, err?: unknown, data?: LogData, options?: LogWriteOptions): void;
alert(msg: string, err?: unknown, data?: LogData, options?: LogWriteOptions): void;
emergency(msg: string, err?: unknown, data?: LogData, options?: LogWriteOptions): void;

setContext(context: LogData): void;
child(bindings: LogData): Logger;
readonly traceId: string | undefined;
```

- **Log calls never throw.** If an entry cannot be written, one fallback line is written with `console.error`. It carries `original_level`, `original_msg`, `trace_id` and `reason`.
- **Levels are checked first.** A call below the minimum level returns before doing any work.
- **`data`** is sanitized and nested under `data`. `{ placement: "flat" }` merges its keys into the entry instead.
- **`err`** accepts any thrown value (`catch (error)` needs no cast) and is serialized to `SerializedError`.
- **`setContext()`** merges fields into every later entry from this logger. They are sanitized once, when set.
- **`child(bindings)`** returns a logger that shares the request, trace id, level, output and buffer, and has its own copy of the context plus `bindings`. Changes to one logger's context don't affect the other.
- **`traceId`** is the resolved correlation id, handy for error responses or for passing to downstream services.
- **Reserved keys.** Context, bindings and flat data can't overwrite `level`, `msg`, `time`, `trace_id`, `data`, `err` or `req`. Those keys are ignored.

## Types

```ts
interface LogEntry {
  level: SyslogLevel;
  msg: string;
  time?: string;
  trace_id?: string;
  data?: LogData;
  err?: SerializedError;
  req?: RequestMetadata;
  [key: string]: unknown; // context, bindings, flat data, status, duration_ms
}

interface SerializedError {
  name: string; // "NonError" for thrown non-Error values
  message: string;
  stack?: string;
  code?: string | number;
  status?: number; // e.g. HTTPException
  cause?: unknown; // nested SerializedError, up to 3 levels
  errors?: SerializedError[]; // AggregateError, first 10
}

interface RequestMetadata {
  method: string;
  path: string;
  route?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  cf?: Record<string, unknown>;
}

type LogSink = (entry: LogEntry, info: { level: SyslogLevel; priority: number }) => void;
interface LogSinkObject {
  write: LogSink;
  flush?: () => Promise<void>;
}
```

Keys in an entry follow this order: `level`, `msg`, `time`, `trace_id`, then
context fields, then `data` (or the flat data, `status` and `duration_ms`),
then `err`, then `req`.
