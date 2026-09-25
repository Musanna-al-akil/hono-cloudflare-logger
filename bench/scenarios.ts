/**
 * Shared benchmark scenarios.
 *
 * These scenarios intentionally use only the API surface that existed in
 * 0.1.x (`new Logger({ level, redactKeys, traceId })`, `info(msg, data)`,
 * `error(msg, err, data)` and `logger(config)`), so the exact same file can be
 * run against the code before and after a change.
 *
 * Every console method is replaced with a sink that serializes object
 * arguments with `JSON.stringify`. This keeps the comparison honest: a logger
 * that hands an object to the console is still charged for the serialization
 * the Workers runtime has to do anyway.
 */
import { Hono } from "hono";
import { Logger, logger } from "../src/index.ts";

export interface Scenario {
  group: "logger" | "middleware";
  name: string;
  fn: () => unknown;
}

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

let sinkBytes = 0;

function consoleSink(...args: unknown[]): void {
  for (const arg of args) {
    sinkBytes += typeof arg === "string" ? arg.length : JSON.stringify(arg).length;
  }
}

/** Replaces console output with a serializing no-op sink. Returns a restore function. */
export function installConsoleSink(): () => void {
  const original = CONSOLE_METHODS.map((method) => console[method]);
  for (const method of CONSOLE_METHODS) {
    console[method] = consoleSink;
  }

  return () => {
    CONSOLE_METHODS.forEach((method, index) => {
      console[method] = original[index] as (typeof console)[typeof method];
    });
  };
}

/** Prevents the sink from being optimized away. */
export function consumeSinkBytes(): number {
  const bytes = sinkBytes;
  sinkBytes = 0;
  return bytes;
}

const REDACT_KEYS = ["authorization", "password", "token", "secret", "apiKey", "cookie"];

const SMALL_PAYLOAD = { userId: "user_123", plan: "pro", attempts: 3 };

const NESTED_PAYLOAD = {
  user: {
    id: "user_123",
    email: "someone@example.com",
    password: "hunter2",
    profile: { country: "BD", token: "abc", preferences: { theme: "dark", locale: "en" } },
  },
  request: { authorization: "Bearer xyz", path: "/login", retries: [1, 2, 3] },
  items: [
    { sku: "a-1", qty: 2, secret: "s1" },
    { sku: "b-2", qty: 1, secret: "s2" },
  ],
};

// Built key by key, so V8 stores it in dictionary mode (slow properties).
const WIDE_PAYLOAD: Record<string, unknown> = {};
for (let index = 0; index < 50; index += 1) {
  WIDE_PAYLOAD[`field_${index}`] = index % 3 === 0 ? `value-${index}` : index;
}

// The same fields in a fast-mode object, like an object literal or JSON.parse result.
const WIDE_FAST_PAYLOAD: Record<string, unknown> = { ...WIDE_PAYLOAD };

const SAMPLE_ERROR = new Error("database connection refused");

const REQUEST_HEADERS: Record<string, string> = {
  accept: "application/json",
  "accept-encoding": "gzip, br",
  "accept-language": "en-US,en;q=0.9",
  authorization: "Bearer secret-token",
  "cache-control": "no-cache",
  "cf-connecting-ip": "203.0.113.10",
  "cf-ipcountry": "BD",
  "cf-ray": "8f1c2a3b4c5d6e7f-SIN",
  "content-type": "application/json",
  cookie: "session=abc; theme=dark",
  host: "api.example.com",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "x-forwarded-proto": "https",
  "x-real-ip": "203.0.113.10",
  "x-request-id": "req-123",
};

const CF_PROPERTIES = {
  colo: "SIN",
  country: "BD",
  city: "Dhaka",
  asn: 13335,
  httpProtocol: "HTTP/2",
  tlsVersion: "TLSv1.3",
};

function createRequest(path: string, withHeaders: boolean): Request {
  const init = {
    headers: withHeaders ? REQUEST_HEADERS : { "x-request-id": "req-123" },
    cf: CF_PROPERTIES,
  };
  const request = new Request(`http://localhost${path}`, init);
  // workerd honours `init.cf`; other runtimes ignore it, so attach it manually.
  if ((request as Request & { cf?: unknown }).cf === undefined) {
    Object.defineProperty(request, "cf", { value: CF_PROPERTIES });
  }
  return request;
}

function createLoggerScenarios(): Scenario[] {
  const infoLogger = new Logger({ level: "info", traceId: "trace-1" });
  const redactLogger = new Logger({ level: "info", traceId: "trace-1", redactKeys: REDACT_KEYS });
  const contextLogger = new Logger({ level: "info", traceId: "trace-1", redactKeys: REDACT_KEYS });
  contextLogger.setContext({ userId: "user_123", tenant: "acme", feature: "checkout" });

  return [
    {
      group: "logger",
      name: "construct logger (6 redact keys)",
      fn: () => new Logger({ level: "info", traceId: "trace-1", redactKeys: REDACT_KEYS }),
    },
    {
      group: "logger",
      name: "info, small payload",
      fn: () => infoLogger.info("user logged in", SMALL_PAYLOAD),
    },
    {
      group: "logger",
      name: "debug below min level (filtered)",
      fn: () => infoLogger.debug("cache miss", SMALL_PAYLOAD),
    },
    {
      group: "logger",
      name: "info, nested payload + 6 redact keys",
      fn: () => redactLogger.info("checkout submitted", NESTED_PAYLOAD),
    },
    {
      group: "logger",
      name: "info, context + 6 redact keys",
      fn: () => contextLogger.info("cart updated", SMALL_PAYLOAD),
    },
    {
      group: "logger",
      name: "error with Error instance",
      fn: () => infoLogger.error("query failed", SAMPLE_ERROR, { table: "orders" }),
    },
    {
      group: "logger",
      name: "info, wide payload (50 fields)",
      fn: () => infoLogger.info("wide event", WIDE_PAYLOAD),
    },
    {
      group: "logger",
      name: "info, wide payload (50 fields, fast-mode object)",
      fn: () => infoLogger.info("wide event", WIDE_FAST_PAYLOAD),
    },
  ];
}

function createMiddlewareScenarios(): Scenario[] {
  const control = new Hono();
  control.get("/users/:id", (c) => c.text("ok"));

  const silentNoLogs = new Hono();
  silentNoLogs.use("*", logger());
  silentNoLogs.get("/users/:id", (c) => c.text("ok"));

  const silentThreeLogs = new Hono();
  silentThreeLogs.use("*", logger({ redactKeys: REDACT_KEYS }));
  silentThreeLogs.get("/users/:id", (c) => {
    const log = c.get("logger" as never) as Logger;
    log.info("loading user", { id: c.req.param("id") });
    log.info("user loaded", SMALL_PAYLOAD);
    log.info("responding", { cache: "miss" });
    return c.text("ok");
  });

  const access = new Hono();
  access.use("*", logger({ autoLogging: "access" }));
  access.get("/users/:id", (c) => c.text("ok"));

  const accessFull = new Hono();
  accessFull.use(
    "*",
    logger({
      autoLogging: "access",
      header: true,
      includeCfProperties: ["colo", "country", "city", "asn"],
      redactKeys: REDACT_KEYS,
    }),
  );
  accessFull.get("/users/:id", (c) => c.text("ok"));

  const errorMode = new Hono();
  errorMode.use("*", logger({ autoLogging: "error" }));
  errorMode.onError((_err, c) => c.text("internal error", 500));
  errorMode.get("/users/:id", () => {
    throw SAMPLE_ERROR;
  });

  const plainRequest = createRequest("/users/42", false);
  const headerRequest = createRequest("/users/42", true);

  return [
    {
      group: "middleware",
      name: "control: no logger middleware",
      fn: () => control.request(plainRequest),
    },
    {
      group: "middleware",
      name: "silent, no logs",
      fn: () => silentNoLogs.request(plainRequest),
    },
    {
      group: "middleware",
      name: "silent, 3 handler logs + redact",
      fn: () => silentThreeLogs.request(plainRequest),
    },
    {
      group: "middleware",
      name: "access log",
      fn: () => access.request(plainRequest),
    },
    {
      group: "middleware",
      name: "access log + 15 headers + cf + redact",
      fn: () => accessFull.request(headerRequest),
    },
    {
      group: "middleware",
      name: "error mode, thrown error",
      fn: () => errorMode.request(plainRequest),
    },
  ];
}

export function createScenarios(): Scenario[] {
  return [...createLoggerScenarios(), ...createMiddlewareScenarios()];
}
