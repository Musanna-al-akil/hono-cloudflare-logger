# Configuration

## `LoggerConfig`

```ts
interface LoggerConfig {
  level?: SyslogLevel;
  traceHeader?: string;
  autoLogging?: "silent" | "access" | "error";
  includeCfProperties?: readonly string[];
  redactKeys?: readonly string[];
  header?: boolean | readonly string[];
}
```

## Options

### `level`

- Default: `info`
- Defines minimum severity to emit.

### `traceHeader`

- Default: `X-Request-Id`
- Trace extraction precedence:

1. `traceHeader`
2. `cf-ray`
3. omit `trace_id`

### `autoLogging`

- Default: `silent`
- `silent`: no automatic logs
- `access`: one response-end log
- `error`: logs only on thrown errors or 5xx responses

### `includeCfProperties`

- Default: `[]`
- Picks selected keys from `c.req.raw.cf` into `req.cf`.

Example:

```ts
logger({ includeCfProperties: ["colo", "country"] });
```

### `redactKeys`

- Default: `[]`
- Case-insensitive deep redaction across nested objects/arrays.

Example:

```ts
logger({ redactKeys: ["authorization", "password", "token"] });
```

### `header`

- Default: `false`
- Controls request header capture in `req.headers`.
- `false`: disable header capture.
- `true`: include all request headers.
- `string[]`: include only allowlisted headers.

Examples:

```ts
logger({ header: true });
logger({ header: ["x-request-id", "authorization"] });
```

## Defaults

```ts
logger({
  level: "info",
  traceHeader: "X-Request-Id",
  autoLogging: "silent",
  includeCfProperties: [],
  redactKeys: [],
  header: false,
});
```
