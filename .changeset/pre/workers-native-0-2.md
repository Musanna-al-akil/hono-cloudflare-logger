---
"hono-cloudflare-logger": minor
---

Workers-native logging, faster hot paths and new features. See `docs/migration-0.2.md` for the upgrade steps and `BENCHMARKS.md` for before/after numbers.

**Breaking changes**

- Entries are passed to the console as objects by default, so Workers Logs indexes every field. Use `format: "json"` for JSON strings (no trailing newline) or `"pretty"` for local development.
- Levels map to `console.debug`, `console.info`, `console.warn` and `console.error`.
- Per-call data moves from `trace` to `data`, and `{ dataPlacement: "trace" | "flat" }` becomes `{ placement: "nested" | "flat" }`.
- `req.url` becomes `req.path`. `req.route` (the matched pattern) is added.
- `error()` and the other error-level methods accept any thrown value. Errors serialize to `{ name, message, stack, code, status, cause, errors }`.
- A trace id is generated with `crypto.randomUUID()` when the request has none (`generateTraceId: false` to disable).
- Peer dependency `hono` is now `^4.8.0`.

**Features**

- `trace_id` from Hono's `requestId()`, `traceHeader`, W3C `traceparent`, `cf-ray` or a generated id. `responseHeader` echoes it.
- `level` accepts a function, e.g. `(c) => c.env.LOG_LEVEL`. Also new: `child()`, `traceId`, and `createLogger()` for code outside Hono.
- `getLogger()` from the new `hono-cloudflare-logger/context` entry (uses `hono/context-storage`).
- `c.var.logger` is typed without app generics.
- Automatic entries use status-based levels (`warning` for 4xx, `error` for 5xx with `err`). Also new: `sampleRate`, `skip` and `bufferUntilError`.
- `sink` (a function or `{ write, flush }`, flushed via `waitUntil`), plus `timestamp`, `censor`, `maxStringLength` and `query`.
- Redaction ignores case and separators. Credential headers are always censored. Cycles, BigInt, Map/Set, binary data and long strings are handled.

**Fixes**

- `autoLogging: "error"` no longer reports `HTTPException` 4xx as unhandled errors.
- Falsy non-Error throws are rethrown.
- A log call never throws.

**Performance**

- Config is resolved once, and request metadata is built lazily.
- Context is sanitized once, when it is set.
- Log calls are 1.3x–3x faster and logging middleware 1.1x–1.5x faster in Node.js and workerd. Very wide payloads (50+ fields) are 18–35% slower because of the new always-on safety pass.
