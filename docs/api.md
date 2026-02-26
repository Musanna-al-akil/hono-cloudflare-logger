# API Reference

## Exports

```ts
export { logger } from "hono-cloudflare-logger";
export { Logger } from "hono-cloudflare-logger";
export type {
  SyslogLevel,
  LoggerConfig,
  LogContext,
  LogEntry,
  LoggerVariables,
  AutoLoggingMode,
  RequestMetadata,
  ErrorMetadata,
} from "hono-cloudflare-logger";
```

## `logger(config?: LoggerConfig)`

Creates middleware that injects a request-scoped `Logger` into Hono context.

```ts
const app = new Hono<{ Variables: LoggerVariables }>();
app.use("*", logger({ autoLogging: "access" }));
```

`LoggerConfig.header` defaults to `false` to avoid request-header capture costs. Set
`header: true` for full headers, or pass an allowlist array for selected headers.
Trace ID extraction checks `traceHeader` first, then falls back to `cf-ray`.

### Context access

```ts
const log = c.get("logger");
log.info("hello");
```

Serialized output order is deterministic and begins with `level`, `msg`, then `trace` (if present), then `time`.

## `class Logger`

### Standard methods

- `debug(msg, data?)`
- `info(msg, data?)`
- `notice(msg, data?)`
- `warning(msg, data?)`

By default, `data` is placed under `trace` in the output entry.
When using `{ dataPlacement: 'flat' }`, reserved keys (`level`, `msg`, `time`, `trace`) are ignored to keep canonical output fields stable.

### Error methods

- `error(msg, err?, data?)`
- `critical(msg, err?, data?)`
- `alert(msg, err?, data?)`
- `emergency(msg, err?, data?)`

You can override placement with an optional final argument:

- `info(msg, data, { dataPlacement: 'flat' })`
- `error(msg, err, data, { dataPlacement: 'flat' })`

`err` is serialized as:

```json
{
  "message": "...",
  "stack": "..."
}
```

### Context mutation

- `setContext(context)` shallow-merges onto request logger context.
- Last write wins for conflicting keys.

## Types

### `SyslogLevel`

```ts
type SyslogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";
```

### `LoggerVariables`

```ts
type LoggerVariables = {
  logger: Logger;
};
```
