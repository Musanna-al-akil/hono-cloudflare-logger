# Migrating from 0.1 to 0.2

0.2 changes the output shape to fit Workers Logs and renames a few fields. Most
apps need only the changes in the first section; everything else is additive.

## Breaking changes

| 0.1                                                                     | 0.2                                                                                                                 | What to do                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each entry was a JSON string ending in `\n`                             | Each entry is an **object** passed to `console.*`                                                                   | Nothing on Workers: Workers Logs now indexes every field. For NDJSON strings (e.g. a Node pipeline), set `format: "json"`; the trailing `\n` is gone because the console adds its own. |
| `debug`–`warning` went to `console.log`, the rest to `console.error`    | `debug` → `console.debug`, `info`/`notice` → `console.info`, `warning` → `console.warn`, `error`+ → `console.error` | Update any tail/Logpush filters that expected `log` for warnings.                                                                                                                      |
| Per-call data nested under `trace`                                      | Nested under **`data`**                                                                                             | Rename `trace.*` → `data.*` in queries and dashboards.                                                                                                                                 |
| `{ dataPlacement: "trace" \| "flat" }`                                  | `{ placement: "nested" \| "flat" }`                                                                                 | Rename the option.                                                                                                                                                                     |
| `req.url` (it held the path)                                            | `req.path`, plus `req.route` (`/users/:id`)                                                                         | Rename in queries; group by `req.route` for low-cardinality metrics.                                                                                                                   |
| `err: Error` parameter, `{ message, stack }` output                     | `err: unknown`, output `{ name, message, stack, code?, status?, cause?, errors? }`                                  | Remove `as Error` casts; queries on `err.message` keep working.                                                                                                                        |
| No `trace_id` without an `x-request-id`/`cf-ray` header                 | A UUID is generated when no id is found                                                                             | Set `generateTraceId: false` to keep the old behavior.                                                                                                                                 |
| `setContext` / data could not overwrite `level`, `msg`, `time`, `trace` | Reserved keys are now `level`, `msg`, `time`, `trace_id`, `data`, `err`, `req`                                      | Rename any context keys that used these names.                                                                                                                                         |
| Key order `level`, `msg`, `trace`, `time`, …                            | `level`, `msg`, `time`, `trace_id`, context, `data`, `err`, `req`                                                   | Only matters for string comparisons of `json` output.                                                                                                                                  |
| Circular data produced a single fallback line                           | Cycles become `"[Circular]"` and the entry is kept                                                                  | None.                                                                                                                                                                                  |
| `new Logger({ req })`                                                   | `req` is only added by the middleware                                                                               | Use `bindings` for fixed fields.                                                                                                                                                       |
| `LogContext = Record<string, any>`                                      | `LogData = Record<string, unknown>` (`LogContext` kept as a deprecated alias)                                       | Narrow values where you read them back.                                                                                                                                                |
| `ErrorMetadata`                                                         | `SerializedError` (`ErrorMetadata` kept as a deprecated alias)                                                      | Rename when convenient.                                                                                                                                                                |
| Peer dependency `hono ^4.0.0`                                           | `hono ^4.8.0`                                                                                                       | Upgrade Hono (`req.route` uses `hono/route`).                                                                                                                                          |

## Behavior fixes you may notice

- `autoLogging: "error"` no longer reports `HTTPException` 4xx (such as 401 and 404) as `Unhandled error`. Only 5xx responses and real errors are written.
- `autoLogging: "access"` writes 4xx as `warning` and 5xx as `error` with the `err` attached. It used to write everything at `info`.
- Falsy non-Error throws (`throw 0`, `throw ""`) are now rethrown instead of swallowed.
- `redactKeys` matching now ignores separators as well as case: `apiKey` also redacts `api_key` and `API-KEY`.
- With `header: true`, credential headers (`authorization`, `cookie`, …) are always censored, even without `redactKeys`.
- Strings longer than `maxStringLength` (default 8192) are truncated.

## New, opt-in

- `c.var.logger` is typed without `Hono<{ Variables: LoggerVariables }>`, so you can drop the generic. npm only: JSR doesn't allow module augmentation, so keep the generic there.
- `level: (c) => c.env.LOG_LEVEL`.
- `child(bindings)` and `log.traceId`.
- `createLogger()` for code outside a request, and `getLogger()` from `hono-cloudflare-logger/context`.
- `traceparent`, `generateTraceId` and `responseHeader`, plus automatic reuse of Hono's `requestId()`.
- `sampleRate`, `skip` and `bufferUntilError`.
- `format`, `sink`, `timestamp`, `censor`, `maxStringLength` and `query`.

## Before and after

```ts
// 0.1
const app = new Hono<{ Variables: LoggerVariables }>();
app.use("*", logger({ autoLogging: "access", redactKeys: ["authorization"] }));
app.get("/", (c) => {
  try {
    // ...
  } catch (error) {
    c.get("logger").error("failed", error as Error, { id: 1 }, { dataPlacement: "flat" });
  }
});

// 0.2
const app = new Hono();
app.use("*", logger({ autoLogging: "access" })); // credential headers are censored by default
app.get("/", (c) => {
  try {
    // ...
  } catch (error) {
    c.var.logger.error("failed", error, { id: 1 }, { placement: "flat" });
  }
});
```
