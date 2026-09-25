# Architecture

## Goals

- **Workers-native output.** Hand Workers Logs objects it can index, on the console method that matches the level.
- **Pay for what you log.** A request that never logs does almost no work. Config is resolved once, not per request.
- **Never break the app.** A log call never throws, and the middleware never swallows the app's errors.
- **Zero runtime dependencies**, and no `node:*` imports in the main entry.

## Modules

| File                | Responsibility                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`      | Public exports; imports `augment.ts`.                                                                                                       |
| `src/augment.ts`    | `ContextVariableMap` augmentation (`c.var.logger`). Kept in its own module because JSR rejects ambient `declare module` in the entry.       |
| `src/middleware.ts` | `logger()`: config validation, per-request core, lazy `req` metadata, automatic entries, buffer flush/discard, response header, sink flush. |
| `src/logger.ts`     | `Logger`, `createLogger()`, the shared per-request `LoggerCore`, entry assembly and buffering.                                              |
| `src/config.ts`     | Resolves output options (format, sink, redaction, limits) once. Validates levels and formats.                                               |
| `src/sanitize.ts`   | Single copy-on-write pass: redaction, cycles, depth, truncation, BigInt/Map/Set/binary/class instances.                                     |
| `src/error.ts`      | `serializeError()`: `name`, `message`, `stack`, `code`, `status`, bounded `cause` and `errors`.                                             |
| `src/trace.ts`      | `trace_id` precedence, W3C `traceparent` parsing, id validation.                                                                            |
| `src/sink.ts`       | Writers for `object`/`json`/`pretty`/custom sinks, and the write-failure fallback.                                                          |
| `src/levels.ts`     | Syslog levels, priorities and the console method for each priority.                                                                         |
| `src/time.ts`       | ISO timestamp cached per millisecond.                                                                                                       |
| `src/context.ts`    | `getLogger()`, the `./context` entry (uses `hono/context-storage`).                                                                         |

## Request lifecycle

```
logger(config)                  once: validate, resolve output, build closures
  └─ per request
      createCore(c)             plain object: level, output, c, lazy slots
      c.set("logger", Logger)
      await next()              handler logs through c.var.logger / child() / getLogger()
      auto entry                access/error mode: level from status, sampled, skip()
      buffer                    flush on failure, discard on success
      response header           optional trace id echo
      sink.flush()              via executionCtx.waitUntil()
```

In `silent` mode, with no sink `flush`, no `responseHeader` and no buffering,
the middleware is a synchronous `c.set` plus `next()`. There's no timer and no
extra async frame.

## Lazy per-request core

Every `Logger` for a request, including its children, shares one `LoggerCore`.
The core fills its slots on the first log call that passes the level check:

- **Level.** A `level` function is called once and its result stored.
- **`trace_id`.** Resolved once. See [configuration](configuration.md#correlation) for the precedence.
- **`req`.** Built and sanitized once, then reused. It's rebuilt only when `c.req.routeIndex` changes, which happens when Hono moves from middleware to the handler, so `req.route` names the handler's pattern.

Headers, `request.cf` and the query string are never read for requests that
don't log.

## Entry assembly

`write()`:

1. Level check. It returns before allocating anything if the entry is filtered.
2. Build `level`, `msg`, `time`, `trace_id`.
3. Copy the context (already sanitized in `setContext()`/`child()`).
4. Sanitize the per-call `data`, nested or flat.
5. Serialize `err`.
6. Attach the cached `req`.
7. Hand the entry to the buffer or the writer.

Only the per-call data and error are sanitized on each call. Context and `req`
are sanitized when they are created. The whole body is inside a `try`; a
failure produces one `console.error` fallback line instead of an exception.

Request metadata and trace ids are best effort. If they can't be read (for
example because two copies of `hono` are installed and `hono/route` can't see
the request's match results), the entry is written without `req`, or with a
generated trace id.

## Sanitize pass

One recursive, copy-on-write walk makes values safe for the console and
`JSON.stringify`:

- Plain objects and arrays are returned by reference unless something inside them changes.
- Numbers, booleans, `undefined` and short strings are passed through inline, with no function call.
- The key matcher normalizes keys (lowercase, separators removed) and memoizes results in a map capped at 512 entries. It is cached per `redactKeys` array.
- No `JSON.stringify` replacer is ever used, so V8's fast serialization path stays available.

## Output

- **`object`.** `console[method](entry)`. The Workers runtime serializes the entry for Workers Logs, with no `JSON.stringify` in the isolate.
- **`json`.** `console[method](JSON.stringify(entry))`.
- **`pretty`.** `HH:MM:SS.mmm LEVEL msg key=value …`, with control characters in the message escaped.
- **custom `sink`.** It receives the finished entry and `{ level, priority }`. Exceptions it throws are caught.

The console method is looked up on every call, so runtime instrumentation (e.g.
Tail Workers, test spies) always sees the entry.

## Buffering (`bufferUntilError`)

The core holds up to 100 entries below `warning`. An `error`-level entry
flushes the buffer before it's written: a "dropped" notice first, if any
entries were dropped, then the entries in order. After that, buffering stops
for the request. When the response is ready, the middleware flushes the buffer
if the request failed (thrown, 5xx) and discards it otherwise.
