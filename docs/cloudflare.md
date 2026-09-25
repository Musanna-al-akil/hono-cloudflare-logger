# Cloudflare guide

This page explains how the logger's output ends up in Cloudflare's tools, and
which settings keep the logs useful and affordable.

## Enable Workers Logs

```jsonc
// wrangler.jsonc
{
  "observability": {
    "enabled": true,
    // Fraction of invocations to keep (platform-level sampling). Default 1.
    "head_sampling_rate": 1,
    "logs": {
      // Cloudflare's own per-request log (method, URL, status, …).
      // Set to false if autoLogging: "access" already covers it for you.
      "invocation_logs": true,
    },
  },
}
```

See [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
for limits and pricing.

## How entries appear

- **Fields are indexed.** With the default `format: "object"`, each entry is passed to `console.*` as an object. Workers Logs extracts its fields, so `level`, `trace_id`, `req.route`, `status`, `data.*` and so on are all searchable. JSON _strings_ (`format: "json"`) are only full-text searchable.
- **Levels are real.** The console method becomes the event's level in the dashboard: `debug`, `info`, `warn` or `error` (see [the mapping](configuration.md#level-and-output)). Filtering by level in the UI matches the logger's own `level` field.
- **Size limit.** An event over 256 KB is truncated by the platform. `maxStringLength` (default 8192 characters per string) and the depth cap of 10 keep single entries well under that.
- **Tail Workers and Logpush.** Tail Workers receive each entry in `logs[].message`, as the arguments passed to the console method. In object mode that's `[entry]`, so there's no parsing step.

## Queries

In the Workers Logs **Query Builder**:

| Question                   | Query                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Everything for one request | filter `trace_id` = `…`                                                                 |
| Errors per route           | filter `level` = `error`, group by `req.route`                                          |
| Slow routes                | filter `msg` = `Request completed`, group by `req.route`, `p99(duration_ms)`            |
| Client errors              | filter `status` ≥ 400 and `status` < 500, group by `status`                             |
| Failures by colo           | filter `level` = `error`, group by `req.cf.colo` (with `includeCfProperties: ["colo"]`) |

`req.route` is the matched pattern (`/users/:id`), so it groups well; `req.path`
has one value per id.

## Correlating requests

- **Hono's `requestId()`.** If you use it, its id becomes `trace_id`, and it already sets `X-Request-Id` on the response.
- **Upstream ids.** A client or upstream service can send `x-request-id` or a W3C `traceparent` header.
- **Fallbacks.** Otherwise `cf-ray` is used, which Cloudflare sets on every request and shows in its error pages. A UUID is generated only when none of these is present.
- **Echoing the id.** Set `responseHeader: "x-request-id"` to return it to clients (not needed with `requestId()`).
- **Downstream calls.** Pass `c.var.logger.traceId` to downstream `fetch` calls so their logs share the id.

## Keeping costs down

Workers Logs bills per log event. Each log call is one event, and so is each
invocation log.

| Lever                                        | Effect                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `autoLogging: "error"` instead of `"access"` | One event per failed request instead of one per request. Keep `invocation_logs` for the rest.      |
| `bufferUntilError: true`                     | Debug and info entries cost nothing on successful requests, and failures still get the full trail. |
| `sampleRate: 0.1`                            | Keeps 10% of successful access entries. Warnings and errors are always kept.                       |
| `skip: (c) => c.req.path === "/health"`      | No automatic entry for probes.                                                                     |
| `level: (c) => c.env.LOG_LEVEL`              | Turn on `debug` for a while through an environment variable, without changing code.                |
| `head_sampling_rate`                         | Platform-level sampling of whole invocations, including this logger's entries.                     |

## Timing caveat

Workers advance `Date.now()` only when I/O happens (a Spectre mitigation).
`duration_ms` is therefore the time spent across I/O (fetches, KV, D1, …).
Purely CPU-bound handlers report `0`. Use the dashboard's CPU time metrics for
compute cost.

## `getLogger()` and `nodejs_compat`

`hono-cloudflare-logger/context` uses Hono's `contextStorage()`, which needs
`AsyncLocalStorage`:

```jsonc
{ "compatibility_flags": ["nodejs_compat"] }
```

The main entry does not import it, so apps that don't use `getLogger()` don't
need the flag.

## One copy of `hono`

`c.var.logger` typing and `getLogger()` rely on the app and this package
sharing the same `hono` module. `hono` is a peer dependency, so a normal
install gives you one copy. If `getLogger()` returns the default logger inside
a request, or `c.var.logger` is untyped, check for duplicates with
`npm ls hono`. Local `file:` links and path aliases that point at another
checkout's `node_modules` are the usual cause.
