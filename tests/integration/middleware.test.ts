import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/middleware";
import type { LoggerVariables } from "../../src/types";
import {
  loggedCalls,
  loggedEntries,
  onlyEntry,
  spyOnConsole,
  type ConsoleSpies,
} from "../test-utils";

function createRequest(path: string, init?: RequestInit, cf?: Record<string, unknown>): Request {
  const req = new Request(`http://localhost${path}`, init);
  if (cf) {
    Object.defineProperty(req, "cf", { value: cf });
  }
  return req;
}

describe("logger middleware", () => {
  let spies: ConsoleSpies;

  beforeEach(() => {
    spies = spyOnConsole();
  });

  it("uses trace header over cf-ray and includes selected cf properties", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use(
      "*",
      logger({
        traceHeader: "x-request-id",
        includeCfProperties: ["colo", "country"],
      }),
    );
    app.get("/trace", (c) => {
      c.get("logger").info("trace test");
      return c.text("ok");
    });

    await app.request(
      createRequest(
        "/trace",
        {
          headers: {
            "x-request-id": "custom-trace",
            "cf-ray": "fallback-ray",
          },
        },
        { colo: "SJC", country: "US", city: "San Jose" },
      ),
    );

    const entry = onlyEntry(spies);
    const req = entry.req as Record<string, unknown>;

    expect(entry.trace_id).toBe("custom-trace");
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/trace");
    expect(req.route).toBe("/trace");
    expect(req.cf).toEqual({ colo: "SJC", country: "US" });
  });

  it("falls back to cf-ray when configured trace header is missing", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ traceHeader: "x-trace-id" }));
    app.get("/ray", (c) => {
      c.get("logger").info("ray test");
      return c.text("ok");
    });

    await app.request(createRequest("/ray", { headers: { "cf-ray": "ray-123" } }));

    expect(onlyEntry(spies).trace_id).toBe("ray-123");
  });

  it("omits trace_id when no headers are available", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger());
    app.get("/no-trace", (c) => {
      c.get("logger").info("no trace");
      return c.text("ok");
    });

    await app.request(createRequest("/no-trace"));

    expect(onlyEntry(spies)).not.toHaveProperty("trace_id");
  });

  it("does not read request headers when nothing is logged", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: true, includeCfProperties: ["colo"] }));
    app.get("/quiet", (c) => c.text("ok"));
    const forEachSpy = vi.spyOn(Headers.prototype, "forEach");
    const getSpy = vi.spyOn(Headers.prototype, "get");

    await app.request(createRequest("/quiet"));

    expect(forEachSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    expect(loggedCalls(spies)).toHaveLength(0);
  });

  it("builds request metadata once per request", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: true }));
    app.get("/twice", (c) => {
      c.get("logger").info("one");
      c.get("logger").info("two");
      return c.text("ok");
    });
    const forEachSpy = vi.spyOn(Headers.prototype, "forEach");

    await app.request(createRequest("/twice", { headers: { "x-a": "1" } }));

    expect(forEachSpy).toHaveBeenCalledTimes(1);
    expect(loggedEntries(spies)).toHaveLength(2);
  });

  it("omits request headers by default", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger());
    app.get("/headers-default", (c) => {
      c.get("logger").info("headers default");
      return c.text("ok");
    });

    await app.request(createRequest("/headers-default", { headers: { "x-test-header": "on" } }));

    expect(onlyEntry(spies).req).not.toHaveProperty("headers");
  });

  it("includes request headers when header option is true", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: true }));
    app.get("/headers-enabled", (c) => {
      c.get("logger").info("headers enabled");
      return c.text("ok");
    });

    await app.request(
      createRequest("/headers-enabled", { headers: { "x-test-header": "enabled" } }),
    );

    const req = onlyEntry(spies).req as Record<string, Record<string, unknown>>;
    expect(req.headers?.["x-test-header"]).toBe("enabled");
  });

  it("redacts configured header keys when header logging is enabled", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: true, redactKeys: ["x-tenant-secret"] }));
    app.get("/headers-redact", (c) => {
      c.get("logger").info("headers redact");
      return c.text("ok");
    });

    await app.request(
      createRequest("/headers-redact", { headers: { "x-tenant-secret": "s3cret", accept: "*/*" } }),
    );

    const req = onlyEntry(spies).req as Record<string, Record<string, unknown>>;
    expect(req.headers?.["x-tenant-secret"]).toBe("[REDACTED]");
    expect(req.headers?.accept).toBe("*/*");
  });

  it("always censors credential headers, even when allowlisted", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: ["authorization", "cookie", "x-api-key", "accept"] }));
    app.get("/credentials", (c) => {
      c.get("logger").info("credentials");
      return c.text("ok");
    });

    await app.request(
      createRequest("/credentials", {
        headers: {
          authorization: "Bearer secret",
          cookie: "session=abc",
          "x-api-key": "key",
          accept: "text/plain",
        },
      }),
    );

    const req = onlyEntry(spies).req as Record<string, unknown>;
    expect(req.headers).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      accept: "text/plain",
    });
  });

  it("records the matched route pattern alongside the concrete path", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ autoLogging: "access" }));
    app.use("/users/*", async (c, next) => {
      c.get("logger").debug("auth middleware");
      c.get("logger").info("in middleware");
      await next();
    });
    app.get("/users/:id", (c) => {
      c.get("logger").info("in handler");
      return c.text("ok");
    });

    await app.request(createRequest("/users/42"));

    const routes = loggedEntries(spies).map((entry) => [
      entry.msg,
      (entry.req as Record<string, unknown>).route,
      (entry.req as Record<string, unknown>).path,
    ]);
    expect(routes).toEqual([
      ["in middleware", "/users/*", "/users/42"],
      ["in handler", "/users/:id", "/users/42"],
      ["Request completed", "/users/:id", "/users/42"],
    ]);
  });

  it("includes query parameters only when enabled, redacting sensitive keys", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("/with/*", logger({ query: true, redactKeys: ["token"] }));
    app.use("/without/*", logger());
    app.get("*", (c) => {
      c.get("logger").info("query");
      return c.text("ok");
    });

    await app.request(createRequest("/with/q?page=2&token=abc"));
    await app.request(createRequest("/without/q?page=2"));

    const [withQuery, withoutQuery] = loggedEntries(spies);
    expect(withQuery?.req).toMatchObject({ query: { page: "2", token: "[REDACTED]" } });
    expect(withoutQuery?.req).not.toHaveProperty("query");
  });

  it("includes only allowlisted request headers", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: ["X-Request-Id", "accept"] }));
    app.get("/headers-allowlist", (c) => {
      c.get("logger").info("headers allowlist");
      return c.text("ok");
    });

    await app.request(
      createRequest("/headers-allowlist", {
        headers: { "x-request-id": "trace-1", accept: "text/plain", "x-ignored": "ignored" },
      }),
    );

    const req = onlyEntry(spies).req as Record<string, unknown>;
    expect(req.headers).toEqual({ "x-request-id": "trace-1", accept: "text/plain" });
  });

  it("emits a response-end access log with status and duration", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ autoLogging: "access" }));
    app.get("/created", (c) => c.json({ created: true }, 201));

    const response = await app.request(createRequest("/created"));
    expect(response.status).toBe(201);

    const entry = onlyEntry(spies);
    expect(entry.msg).toBe("Request completed");
    expect(entry.level).toBe("info");
    expect(entry.status).toBe(201);
    expect(typeof entry.duration_ms).toBe("number");
    expect(entry).not.toHaveProperty("data");
    expect(Object.keys(entry).slice(0, 3)).toEqual(["level", "msg", "time"]);
  });

  it("auto-logs unhandled errors in error mode", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ autoLogging: "error" }));
    app.get("/boom", () => {
      throw new Error("boom");
    });

    const response = await app.request(createRequest("/boom"));
    expect(response.status).toBe(500);

    const entry = loggedEntries(spies).find((item) => item.msg === "Unhandled error");
    expect(entry).toBeDefined();
    expect(entry?.level).toBe("error");
    expect(entry?.err).toMatchObject({ message: "boom" });
    expect(typeof entry?.duration_ms).toBe("number");
  });

  it("auto-logs 5xx responses in error mode", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ autoLogging: "error" }));
    app.get("/503", (c) => c.text("down", 503));

    const response = await app.request(createRequest("/503"));
    expect(response.status).toBe(503);

    const calls = loggedCalls(spies);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("error");
    expect(calls[0]?.entry).toMatchObject({ msg: "Request failed", level: "error", status: 503 });
  });

  it("flushes a sink after each request", async () => {
    const flush = vi.fn(async () => {});
    const written: string[] = [];
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ sink: { write: (entry) => written.push(entry.msg), flush } }));
    app.get("/sink", (c) => {
      c.get("logger").info("to sink");
      return c.text("ok");
    });

    await app.request(createRequest("/sink"));
    await Promise.resolve();

    expect(written).toEqual(["to sink"]);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("hands the flush promise to executionCtx.waitUntil when available", async () => {
    const waitUntil = vi.fn();
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ sink: { write: () => {}, flush: async () => {} } }));
    app.get("/ctx", (c) => c.text("ok"));

    await app.fetch(createRequest("/ctx"), {}, {
      waitUntil,
      passThroughOnException: () => {},
      props: {},
    } as never);

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
  });

  it("nests route-level payload under data", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger());
    app.get("/custom-payload", (c) => {
      c.get("logger").info("custom payload", { name: "John Doe", age: 30 });
      return c.text("ok");
    });

    await app.request(createRequest("/custom-payload"));

    const entry = onlyEntry(spies);
    expect(entry.data).toEqual({ name: "John Doe", age: 30 });
    expect(entry).not.toHaveProperty("name");
  });
});
