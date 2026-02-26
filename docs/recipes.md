# Recipes

## Attach Auth Context

```ts
app.use("*", async (c, next) => {
  const log = c.get("logger");
  const userId = c.req.header("x-user-id");

  if (userId) {
    log.setContext({ userId });
  }

  await next();
});
```

## Request Correlation

```ts
app.use("*", logger({ traceHeader: "x-request-id" }));
```

If the header is missing, `cf-ray` is used automatically.

## Redact Secrets

```ts
app.use("*", logger({ redactKeys: ["authorization", "password", "token"] }));
```

This applies to nested objects and arrays as well.

## Error-Only Automatic Logging

```ts
app.use("*", logger({ autoLogging: "error" }));
```

This will log when:

- an unhandled error is thrown
- a route returns status `500+`

## Access Logs With Duration

```ts
app.use("*", logger({ autoLogging: "access" }));
```

Produces one response-end log including:

- `status`
- `duration_ms`
- request metadata (`req.method`, `req.url`, optional `req.cf`)

## Custom Structured Payload

```ts
app.get("/hello", (c) => {
  c.get("logger").info("Hello Hono!", { name: "John Doe", age: 30 });
  return c.text("ok");
});
```

`data` is emitted as:

- `trace.name`
- `trace.age`
