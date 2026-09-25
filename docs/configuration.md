# Configuration

`logger(config)` validates its options once, when the middleware is created. An
unknown `level`, `format` or `autoLogging` value, a `sampleRate` outside 0–1, or
a non-positive `maxStringLength` throws a `TypeError` at startup, not on the
first request.

```ts
import { logger } from "hono-cloudflare-logger";

app.use("*", logger({ autoLogging: "access", redactKeys: ["password"] }));
```

## Level and output

| Option      | Type                                         | Default    | Description                                                                                                                                                               |
| ----------- | -------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`     | `SyslogLevel \| (c) => string \| undefined`  | `"info"`   | Minimum level. A function runs at most once per request, on the first log call, e.g. `(c) => c.env.LOG_LEVEL`. Unknown values or a throwing function fall back to `info`. |
| `format`    | `"object" \| "json" \| "pretty"`             | `"object"` | `object` passes the entry to `console.*` (Workers Logs indexes its fields). `json` writes one JSON string. `pretty` writes a readable line for local development.         |
| `sink`      | `(entry, info) => void \| { write, flush? }` | —          | Replaces the console. `info` is `{ level, priority }`. `flush()` runs after each request through `executionCtx.waitUntil()`. Exceptions from `write` are caught.          |
| `timestamp` | `boolean`                                    | `true`     | Adds an ISO-8601 `time`. Workers Logs timestamps events too, so `false` saves a few bytes per entry.                                                                      |

Levels follow RFC 5424 severities. Each one maps to the console method that
Workers Logs uses as the event level:

| Level                                     | Console method  |
| ----------------------------------------- | --------------- |
| `debug`                                   | `console.debug` |
| `info`, `notice`                          | `console.info`  |
| `warning`                                 | `console.warn`  |
| `error`, `critical`, `alert`, `emergency` | `console.error` |

## Correlation

| Option            | Type                    | Default             | Description                                                                                                                                        |
| ----------------- | ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `traceHeader`     | `string \| false`       | `"x-request-id"`    | Request header read for `trace_id`.                                                                                                                |
| `traceparent`     | `boolean`               | `true`              | Use the trace-id of a W3C `traceparent` header.                                                                                                    |
| `generateTraceId` | `false \| () => string` | `crypto.randomUUID` | Generates an id when the request carries none. `false` omits `trace_id` in that case.                                                              |
| `responseHeader`  | `string \| false`       | `false`             | Echo the trace id on the response, e.g. `"x-request-id"`. An existing header is left untouched. Skipped when the handler throws a non-Error value. |

`trace_id` resolution order:

1. `c.var.requestId`, set by Hono's [`requestId()`](https://hono.dev/docs/middleware/builtin/request-id) middleware.
2. The `traceHeader` header.
3. The trace-id field of `traceparent`.
4. `cf-ray`, which Cloudflare sets on every request.
5. `generateTraceId()`.

An inbound id is used only if it is 1–255 printable ASCII characters with no
spaces. Anything else falls through to the next source, so a crafted header
cannot inject control characters into logs.

## Request metadata (`req`)

| Option                | Type                           | Default | Description                                                                                                                |
| --------------------- | ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `includeCfProperties` | `readonly CfPropertyKey[]`     | `[]`    | `request.cf` keys copied to `req.cf`, e.g. `["colo", "country", "asn"]`. Common keys autocomplete; any string is accepted. |
| `header`              | `boolean \| readonly string[]` | `false` | `true` copies every request header to `req.headers`; an array is an allowlist (case-insensitive).                          |
| `query`               | `boolean`                      | `false` | Copies query parameters to `req.query`. They are redacted like any other data.                                             |

`req.method`, `req.path` and `req.route` (the matched pattern, e.g.
`/users/:id`) are always present. `req` is built on the first log call of a
request and reused, and it is rebuilt when Hono moves from middleware to the
route handler, so `route` stays accurate.

`authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key` and
`cf-access-jwt-assertion` are always replaced with the `censor` value when
headers are captured.

## Redaction and size

| Option            | Type                | Default        | Description                                                                                                                                          |
| ----------------- | ------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redactKeys`      | `readonly string[]` | `[]`           | Keys whose values are replaced at any depth. Matching ignores case and `-`, `_`, `.` and spaces: `apiKey` matches `api_key`, `API-KEY` and `apikey`. |
| `censor`          | `string`            | `"[REDACTED]"` | Replacement for redacted values and censored headers.                                                                                                |
| `maxStringLength` | `number`            | `8192`         | Longer strings are cut and marked `…[truncated N chars]`. Workers Logs truncates events over 256 KB.                                                 |

Every entry is made safe to write whatever the options are:

- Cycles become `"[Circular]"`, and nesting deeper than 10 levels becomes `"[Object]"` or `"[Array]"`.
- BigInt and symbols become strings, and functions are dropped.
- `Map` → object, `Set` → array, binary data → `"[Uint8Array(4)]"`, and anything with `toJSON()` (e.g. `Date`) uses it.
- Class instances are copied as plain objects, and values whose getters throw become `"[Unserializable]"`.
- Unchanged objects are passed by reference, not copied.

## Automatic entries and cost control

| Option             | Type                              | Default    | Description                                                                                                                     |
| ------------------ | --------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `autoLogging`      | `"silent" \| "access" \| "error"` | `"silent"` | `access`: one entry per request. `error`: only failed requests.                                                                 |
| `sampleRate`       | `number` (0–1)                    | `1`        | Fraction of successful `info` access entries to keep. Warnings and errors are never sampled.                                    |
| `skip`             | `(c) => boolean`                  | —          | `true` suppresses the automatic entry (e.g. health checks). `c.var.logger` still works. A throwing predicate counts as `false`. |
| `bufferUntilError` | `boolean`                         | `false`    | Hold `debug`/`info`/`notice` entries. See below.                                                                                |

**Automatic entry levels.** A thrown error or a 5xx response is written at
`error`:

- `"Unhandled error"` with `err` when there is an error.
- `"Request failed"` when there is no error.

In `access` mode, 4xx responses (including `HTTPException` 4xx) are written as
`warning "Request completed"`, and everything else as `info "Request
completed"`. Automatic entries add top-level `status` and `duration_ms`.
`duration_ms` measures wall time across I/O, because Workers only advance the
clock between I/O operations.

**`bufferUntilError`.**

- Entries below `warning` are held in memory, up to 100 per request; the oldest are dropped first.
- If the request fails (a 5xx, a thrown error, or any `error`-level entry), the buffer is written in order before the failure entry, together with a count of dropped entries. Later entries in that request are written straight through.
- If the request succeeds, the buffer is discarded.
- Warnings and errors are never buffered.

## Standalone loggers

`createLogger(options)` takes the output options above (`format`, `sink`,
`timestamp`, `redactKeys`, `censor`, `maxStringLength`) plus:

| Option     | Type          | Default  | Description                                          |
| ---------- | ------------- | -------- | ---------------------------------------------------- |
| `level`    | `SyslogLevel` | `"info"` | Minimum level.                                       |
| `traceId`  | `string`      | —        | Added to every entry as `trace_id`.                  |
| `bindings` | `LogData`     | —        | Fields added to every entry, as with `setContext()`. |

A standalone logger has no request, so it never adds `req` and never flushes a
sink on its own. Call `sink.flush()` yourself, e.g. `ctx.waitUntil(sink.flush())`.
