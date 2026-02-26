# Architecture

## Goals

- Structured logs with deterministic machine parsing
- Worker-friendly output path (`console.log`/`console.error`)
- No runtime dependencies
- Predictable behavior under failure (serialization fallback)

## Runtime Flow

1. `logger(config)` middleware runs per request.
2. Middleware builds base metadata (`req`, `trace_id`, selected `req.cf` fields).
3. Middleware injects `Logger` at `c.set('logger', loggerInstance)`.
4. Route handlers write manual logs with `c.get('logger')`.
5. Auto logging mode (if enabled) emits lifecycle logs in middleware `finally`.

## Data Model

A log entry is assembled from:

- immutable core: `level`, `time`, `msg`
- request-scoped base metadata: `req`, optional `trace_id`
- mutable context from `setContext()`
- call-scoped data (default under `trace`)
- optional serialized error object (`err.message`, `err.stack`)

Final merge order before core fields:

1. base metadata
2. context (`setContext`)
3. per-call data placement (`trace` by default, or flat override)

Core fields are applied last to avoid accidental overrides.

## Redaction Strategy

- `redactKeys` are normalized to lowercase.
- Redaction recursively traverses objects and arrays with copy-on-write to avoid cloning unchanged branches.
- Matching key names are replaced with `[REDACTED]`.
- Circular references are preserved in traversal graph, then handled by serializer fallback.

## Serialization Strategy

- Normal case: `JSON.stringify(entry) + '\n'`
- Failure case: emit exactly `{"level":"error","msg":"Logger failed to serialize object"}\n`
- Deterministic key order: `level`, `msg`, optional `trace`, `time`, then remaining fields

This ensures logger failures do not crash request processing.

## Log Level Routing

- `debug/info/notice/warning` -> `console.log`
- `error/critical/alert/emergency` -> `console.error`

## Auto Logging Modes

- `silent`: no automatic entries
- `access`: one response-end info entry with `status` + `duration_ms`
- `error`: automatic error entry only for thrown errors or `status >= 500`

Middleware auto logs use flat placement for `status` and `duration_ms`.
