# hono-cloudflare-logger

Workers-first, zero-runtime-dependency logging middleware for [Hono](https://hono.dev/) with newline-delimited JSON (NDJSON) output.

## Features

- RFC 5424 log levels: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`
- Request-scoped logger via `c.get('logger')`
- Auto logging modes: `silent`, `access`, `error`
- Deep case-insensitive key redaction
- Trace ID extraction via configurable header with `cf-ray` fallback
- Error serialization with `message` and `stack` only
- Circular serialization fallback without crashing request handling

## Requirements

- Node.js `22+` (tooling)
- Hono `^4` (peer dependency)
- ESM consumers

## Install

```bash
npm install hono hono-cloudflare-logger
```

## Beta Releases

Stable releases are published under the default `latest` dist-tag, while prerelease builds are published under the `beta` dist-tag.

```bash
npm install hono-cloudflare-logger@beta
```

For beta publishing steps, see [docs/publishing.md#beta-prereleases](docs/publishing.md#beta-prereleases).

## Quick Start

```ts
import { Hono } from "hono";
import { logger, type LoggerVariables } from "hono-cloudflare-logger";

const app = new Hono<{ Variables: LoggerVariables }>();

app.use(
  "*",
  logger({
    autoLogging: "access",
    redactKeys: ["authorization", "password"],
    includeCfProperties: ["colo", "country"],
  }),
);

app.post("/login", async (c) => {
  const log = c.get("logger");
  log.setContext({ requestArea: "auth" });

  log.info("Login started");

  try {
    log.info("Login successful", { userId: "user_123" });
    return c.json({ ok: true });
  } catch (error) {
    log.error("Login failed", error as Error);
    return c.json({ ok: false }, 500);
  }
});

export default app;
```

## API

### `logger(config?: LoggerConfig)`

Returns a Hono middleware that injects a per-request logger at `c.get('logger')`.

### `class Logger`

- `debug/info/notice/warning(msg: string, data?: Record<string, any>, options?: { dataPlacement?: 'trace' | 'flat' }): void`
- `error/critical/alert/emergency(msg: string, err?: Error, data?: Record<string, any>, options?: { dataPlacement?: 'trace' | 'flat' }): void`
- `setContext(context: Record<string, any>): void`

Application log `data` is nested under `trace` by default. Use `dataPlacement: 'flat'` only when you need top-level fields.
Middleware auto logs keep `status` and `duration_ms` at the top level.
Serialized key order is deterministic: `level`, `msg`, `trace` (if present), `time`, then remaining fields.

## LoggerConfig

| Option                | Type                              | Default        | Description                                              |
| --------------------- | --------------------------------- | -------------- | -------------------------------------------------------- |
| `level`               | `SyslogLevel`                     | `info`         | Minimum level to emit                                    |
| `traceHeader`         | `string`                          | `X-Request-Id` | Primary header for `trace_id` extraction                 |
| `autoLogging`         | `'silent' \| 'access' \| 'error'` | `silent`       | Automatic request logging behavior                       |
| `includeCfProperties` | `readonly string[]`               | `[]`           | Cloudflare `c.req.raw.cf` keys to include under `req.cf` |
| `redactKeys`          | `readonly string[]`               | `[]`           | Keys to redact recursively as `[REDACTED]`               |
| `header`              | `boolean \| readonly string[]`    | `false`        | `false` disable, `true` all headers, or allowlisted keys |

## Log Schema

Each output line is NDJSON with newline suffix:

```json
{
  "level": "info",
  "msg": "Login successful",
  "trace": {
    "userId": "user_123"
  },
  "time": "2026-02-26T12:00:00.000Z",
  "trace_id": "abc-123",
  "req": {
    "method": "GET",
    "url": "/login",
    "cf": {
      "colo": "SJC"
    }
  }
}
```

## Docs

- [Architecture](docs/architecture.md)
- [API Reference](docs/api.md)
- [Configuration Guide](docs/configuration.md)
- [Recipes](docs/recipes.md)
- [Publishing](docs/publishing.md)

## Examples

- [Minimal example](examples/minimal)
- [Advanced example](examples/advanced)

## Development

```bash
npm install
npm run format
npm run format:check
npm run lint
npm run test
npm run build
```

## Release

```bash
npm run changeset
npm run version-packages
npm run release
```

For CI-based release flow, see [docs/publishing.md](docs/publishing.md).
