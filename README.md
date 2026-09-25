# hono-cloudflare-logger

Structured logging for [Hono](https://hono.dev/) on Cloudflare Workers. It is
built around how Workers Logs actually stores and bills log events. Zero runtime
dependencies; it adds about 4.8 KB min+gzip to a Worker ([details](BENCHMARKS.md#bundle-size)).

```ts
import { Hono } from "hono";
import { logger } from "hono-cloudflare-logger";

const app = new Hono();
app.use("*", logger({ autoLogging: "access" }));

app.get("/users/:id", (c) => {
  c.var.logger.info("user loaded", { id: c.req.param("id") });
  return c.json({ ok: true });
});

export default app;
```

```js
// What Workers Logs receives (an object, so every field is indexed and queryable)
{
  level: "info", msg: "user loaded", time: "2026-09-25T12:00:00.000Z",
  trace_id: "8f1c2a3b4c5d6e7f-SIN",
  data: { id: "42" },
  req: { method: "GET", path: "/users/42", route: "/users/:id" }
}
```

## Why

| Need on Workers                                      | hono-cloudflare-logger                                              | Typical Node logger / Hono `logger()`  |
| ---------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| Fields indexed by Workers Logs                       | Logs **objects** by default                                         | Strings: text search only              |
| Correct level in the dashboard                       | `warning` → `console.warn`, `debug` → `console.debug`, …            | Often everything on `console.log`      |
| Low-cardinality grouping                             | `req.route` (`/users/:id`)                                          | Raw paths                              |
| Correlation                                          | `requestId()`, `x-request-id`, W3C `traceparent`, `cf-ray`, or UUID | Manual                                 |
| Per-event billing                                    | `bufferUntilError`, `sampleRate`, `skip`                            | Log everything or nothing              |
| Safe entries (secrets, cycles, BigInt, 256 KB limit) | Built-in redaction, censoring and truncation                        | Crashes or leaks unless configured     |
| Runtime fit                                          | No `node:*` imports in the core, no transports                      | Transports that do not run on the edge |

## Install

```bash
npm install hono hono-cloudflare-logger
```

```bash
npx jsr add @musanna/hono-cloudflare-logger   # or: deno add jsr:@musanna/hono-cloudflare-logger
```

Requires `hono` `^4.8.0`. ESM only. Prereleases use the `beta` dist-tag:
`npm install hono-cloudflare-logger@beta`.

JSR doesn't allow module augmentation, so the JSR package can't type
`c.var.logger` for you. Declare it on the app instead:
`new Hono<{ Variables: LoggerVariables }>()`.

Enable Workers Logs in `wrangler.jsonc`:

```jsonc
{ "observability": { "enabled": true } }
```

## Features

- **Workers-native output.** Objects by default (`format: "json"` for NDJSON strings, `"pretty"` for local dev), with a console method that matches each level.
- **Request logger on `c.var.logger`.** Typed without app generics, with `setContext()`, `child()` and `traceId`.
- **Lazy request metadata.** Headers, `cf` and route are read only when something is actually logged. Requests that never log stay cheap.
- **Automatic entries.** `access` writes one entry per request (`info` 2xx/3xx, `warning` 4xx, `error` 5xx or thrown), with `status` and `duration_ms`. `error` writes only the failures.
- **Cost control.**
  - `bufferUntilError` keeps debug/info entries in memory and writes them only when the request fails.
  - `sampleRate` samples successful access entries.
  - `skip` drops entries such as health checks.
- **Level per request.** `level: (c) => c.env.LOG_LEVEL` changes verbosity without a deploy.
- **Tracing.** `trace_id` comes from Hono's `requestId()`, a header, W3C `traceparent` or `cf-ray`, or is generated with `crypto.randomUUID()`. `responseHeader` echoes it on the response.
- **Errors.** `name`, `message`, `stack`, `code`, `status` (e.g. `HTTPException`), `cause` chains, `AggregateError.errors`, and non-Error throws.
- **Safety.**
  - Key redaction that ignores case and separators (`apiKey` = `api_key`).
  - Credential headers are always censored.
  - Cycles, BigInt, Map/Set and binary values are handled, and long strings are truncated.
  - A log call never throws.
- **Outside Hono.** `createLogger()` for `scheduled`, `queue` and Durable Objects. `getLogger()` from `hono-cloudflare-logger/context` works anywhere in a request (uses `hono/context-storage`).
- **Custom sinks.** Pass a function or `{ write, flush }`. `flush` runs through `executionCtx.waitUntil()`.

## Usage

```ts
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { logger } from "hono-cloudflare-logger";

type Env = { Bindings: { LOG_LEVEL?: string } };
const app = new Hono<Env>();

app.use("*", requestId());
app.use(
  "*",
  logger<Env>({
    level: (c) => c.env.LOG_LEVEL, // "debug" in dev, "info" in production
    autoLogging: "error",
    bufferUntilError: true,
    includeCfProperties: ["colo", "country"],
    header: ["user-agent"],
    redactKeys: ["password", "token"],
  }),
);

app.post("/orders", async (c) => {
  const log = c.var.logger;
  log.setContext({ tenant: c.req.header("x-tenant") });

  const db = log.child({ component: "db" });
  db.debug("inserting order"); // written only if this request fails

  try {
    // ...
    return c.json({ ok: true }, 201);
  } catch (error) {
    log.error("order failed", error, { step: "insert" });
    return c.json({ ok: false }, 500);
  }
});
```

Outside a request:

```ts
import { createLogger } from "hono-cloudflare-logger";

export default {
  fetch: app.fetch,
  async scheduled(controller, env) {
    const log = createLogger({
      traceId: `cron-${controller.scheduledTime}`,
      bindings: { cron: controller.cron },
    });
    log.info("cleanup started");
  },
};
```

## Log schema

```js
{
  level: "error",              // debug | info | notice | warning | error | critical | alert | emergency
  msg: "order failed",
  time: "2026-09-25T12:00:00.000Z", // timestamp: false to omit
  trace_id: "b7a3…",
  tenant: "acme",              // setContext() / child() fields
  data: { step: "insert" },    // per-call data (placement: "flat" merges it instead)
  err: { name: "TypeError", message: "…", stack: "…", cause: { … } },
  req: { method: "POST", path: "/orders", route: "/orders", headers: { … }, cf: { … } },
}
// Automatic entries also carry top-level `status` and `duration_ms`.
```

## Documentation

- [Configuration](docs/configuration.md): every option and its default
- [API reference](docs/api.md)
- [Cloudflare guide](docs/cloudflare.md): Workers Logs setup, queries, cost control
- [Recipes](docs/recipes.md)
- [Architecture](docs/architecture.md)
- [Migrating from 0.1](docs/migration-0.2.md)
- [Benchmarks](BENCHMARKS.md): before/after in Node.js and workerd
- Examples: [minimal](examples/minimal), [advanced](examples/advanced)

## Development

```bash
npm install
npm run lint           # format check, typecheck, oxlint
npm test               # unit, integration and type tests (Node)
npm run test:workers   # the same runtime behaviour inside workerd
npm run test:coverage
npm run bench:compare  # before/after benchmarks, Node and workerd
npm run build && npm run size
npm run prepublish:check
```

Contributor and AI agent notes: [AGENTS.md](AGENTS.md).

## Release

npm gets the built `dist`; JSR gets the TypeScript source. Versions come from
changesets:

```bash
npm run changeset
npm run version-packages   # bumps package.json, jsr.json and CHANGELOG.md
```

Pushing a `vX.Y.Z-beta.N` tag publishes the npm `beta` dist-tag, and any `v*` tag
publishes to JSR (see `.github/workflows`).

## License

MIT
