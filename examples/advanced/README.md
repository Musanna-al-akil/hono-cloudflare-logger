# Advanced Example

## Run

Build the package at the repository root first; the example installs it as a
copy (see `.npmrc`), the way a consumer would get it from npm.

```bash
npm run build
cd examples/advanced
npm install
npm run dev
```

`npm run check` type-checks the example and bundles it with `wrangler deploy --dry-run`.

## What it shows

- `requestId()` from `hono/request-id`: its id becomes `trace_id` and is echoed as `X-Request-Id`.
- `level: (c) => c.env.LOG_LEVEL`: the level comes from the `LOG_LEVEL` var in `wrangler.jsonc`.
- `bufferUntilError`: debug/info entries are written only when the request fails.
- `getLogger()` from `hono-cloudflare-logger/context` with `contextStorage()` (needs `nodejs_compat`).
- `child()` bindings, `redactKeys`, and the `authorization` header being censored.
- `createLogger()` in the `scheduled` handler.

## Try it

```bash
# Success: nothing is logged (buffered entries are dropped).
curl -X POST localhost:8787/login -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"secret"}'

# Wrong password: one `warning` entry.
curl -X POST localhost:8787/login -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"nope"}'

# Failure: the buffered info/debug trail, then the `error` entry.
curl -X POST localhost:8787/login -H 'content-type: application/json' \
  -H 'x-request-id: my-trace' -d '{"email":"fail@example.com","password":"secret"}'

# Cron handler with a standalone logger.
npx wrangler dev --test-scheduled
curl "localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```
