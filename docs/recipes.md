# Recipes

## Attach user context once

```ts
app.use("*", logger());
app.use("*", async (c, next) => {
  const userId = c.req.header("x-user-id");
  if (userId) {
    c.var.logger.setContext({ userId });
  }
  await next();
});
```

Every later entry from this request includes `userId`.

## Per-component loggers

```ts
app.get("/orders/:id", async (c) => {
  const db = c.var.logger.child({ component: "db" });
  db.debug("loading order", { id: c.req.param("id") });
  // …
});
```

## Log from code that has no `c`

```ts
import { contextStorage } from "hono/context-storage";
import { getLogger } from "hono-cloudflare-logger/context";

app.use("*", contextStorage());
app.use("*", logger());

export async function chargeCard(amount: number) {
  getLogger().info("charging card", { amount }); // the current request's logger
}
```

Requires the `nodejs_compat` compatibility flag.

## Change the level without a deploy

```ts
type AppEnv = { Bindings: { LOG_LEVEL?: string } };
app.use("*", logger<AppEnv>({ level: (c) => c.env.LOG_LEVEL }));
```

```jsonc
// wrangler.jsonc
{ "vars": { "LOG_LEVEL": "info" } }
```

Change the variable in the dashboard (or `wrangler.jsonc`) to `debug` while
you investigate. Invalid values fall back to `info`.

## Debug trails only for failed requests

```ts
app.use("*", logger({ autoLogging: "error", bufferUntilError: true, level: "debug" }));
```

Successful requests write nothing (or only their warnings). A request that
throws, returns 5xx or logs an `error` writes its debug/info trail followed by
the error.

## Access logs without the noise

```ts
app.use(
  "*",
  logger({
    autoLogging: "access",
    sampleRate: 0.1, // keep 10% of successful requests
    skip: (c) => c.req.path === "/health",
  }),
);
```

## Correlate with upstream services

```ts
import { requestId } from "hono/request-id";

app.use("*", requestId()); // accepts or generates X-Request-Id and echoes it
app.use("*", logger());

app.get("/", async (c) => {
  const res = await fetch("https://api.example.com", {
    headers: { "x-request-id": c.var.logger.traceId ?? "" },
  });
  return c.json(await res.json());
});
```

Without `requestId()`, set `responseHeader: "x-request-id"` to echo the id.
Incoming W3C `traceparent` headers are also used.

## Capture headers safely

```ts
app.use("*", logger({ header: ["user-agent", "referer", "authorization"] }));
// req.headers.authorization is "[REDACTED]": credential headers are always censored
```

## Redact secrets

```ts
app.use("*", logger({ redactKeys: ["password", "token", "apiKey"] }));

c.var.logger.info("signup", { user: { email, password }, api_key: key });
// data.user.password and data.api_key are "[REDACTED]"
```

Matching ignores case and `-`, `_`, `.` separators, at any depth, including
inside arrays.

## Top-level fields instead of `data`

```ts
c.var.logger.info("checkout", { cartValue: 42 }, { placement: "flat" });
// { level, msg, …, cartValue: 42 }
```

## Logging errors

```ts
try {
  await db.insert(order);
} catch (error) {
  c.var.logger.error("insert failed", error, { orderId: order.id });
  throw error;
}
```

Any thrown value is accepted. `cause` chains, `AggregateError.errors`, `code`,
and `HTTPException` `status` are kept.

To avoid logging the same unhandled error twice (once by the logger, once by
Hono's default handler), give the app an `onError` that doesn't print it:

```ts
import { HTTPException } from "hono/http-exception";

app.onError((error, c) =>
  error instanceof HTTPException
    ? error.getResponse()
    : c.json({ error: "Internal Server Error" }, 500),
);
```

## `scheduled`, `queue` and Durable Objects

```ts
import { createLogger } from "hono-cloudflare-logger";

export default {
  fetch: app.fetch,
  async queue(batch, env) {
    const log = createLogger({ bindings: { queue: batch.queue } });
    for (const message of batch.messages) {
      log.child({ messageId: message.id }).info("processing");
    }
  },
};
```

## Ship entries elsewhere

```ts
const pending: LogEntry[] = [];

app.use(
  "*",
  logger({
    sink: {
      write: (entry) => pending.push(entry),
      flush: async () => {
        const batch = pending.splice(0);
        if (batch.length > 0) {
          await fetch("https://logs.example.com/ingest", {
            method: "POST",
            body: JSON.stringify(batch),
          });
        }
      },
    },
  }),
);
```

`flush()` runs after each response through `executionCtx.waitUntil()`, so
shipping logs does not delay the response.

## Readable logs in `wrangler dev`

```ts
app.use("*", logger({ format: "pretty" }));
// 12:00:00.000 INFO      user loaded trace_id="…" data={"id":"42"} req={…}
```
