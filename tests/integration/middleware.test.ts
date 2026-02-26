import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/middleware";
import type { LoggerVariables } from "../../src/types";
import { parseLoggedEntry, parseLoggedEntryFromCalls } from "../test-utils";

function createRequest(path: string, init?: RequestInit, cf?: Record<string, unknown>): Request {
  const req = new Request(`http://localhost${path}`, init);
  if (cf) {
    (req as Request & { cf?: Record<string, unknown> }).cf = cf;
  }
  return req;
}

describe("logger middleware", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
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

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const req = entry.req as Record<string, unknown>;
    const cf = req.cf as Record<string, unknown>;

    expect(entry.trace_id).toBe("custom-trace");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("/trace");
    expect(cf).toEqual({ colo: "SJC", country: "US" });
  });

  it("falls back to cf-ray when configured trace header is missing", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ traceHeader: "x-trace-id" }));
    app.get("/ray", (c) => {
      c.get("logger").info("ray test");
      return c.text("ok");
    });

    await app.request(
      createRequest("/ray", {
        headers: {
          "cf-ray": "ray-123",
        },
      }),
    );

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    expect(entry.trace_id).toBe("ray-123");
  });

  it("omits trace_id when no headers are available", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger());
    app.get("/no-trace", (c) => {
      c.get("logger").info("no trace");
      return c.text("ok");
    });

    await app.request(createRequest("/no-trace"));

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    expect(entry).not.toHaveProperty("trace_id");
  });

  it("omits request headers by default", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger());
    app.get("/headers-default", (c) => {
      c.get("logger").info("headers default");
      return c.text("ok");
    });

    await app.request(
      createRequest("/headers-default", {
        headers: {
          "x-test-header": "enabled",
        },
      }),
    );

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const req = entry.req as Record<string, unknown>;

    expect(req).not.toHaveProperty("headers");
  });

  it("includes request headers when header option is true", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: true }));
    app.get("/headers-enabled", (c) => {
      c.get("logger").info("headers enabled");
      return c.text("ok");
    });

    await app.request(
      createRequest("/headers-enabled", {
        headers: {
          "x-test-header": "enabled",
        },
      }),
    );

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const req = entry.req as Record<string, unknown>;
    const headers = req.headers as Record<string, unknown>;

    expect(headers["x-test-header"]).toBe("enabled");
  });

  it("omits request headers when header option is false", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: false }));
    app.get("/headers-disabled", (c) => {
      c.get("logger").info("headers disabled");
      return c.text("ok");
    });

    await app.request(
      createRequest("/headers-disabled", {
        headers: {
          "x-test-header": "disabled",
        },
      }),
    );

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const req = entry.req as Record<string, unknown>;

    expect(req).not.toHaveProperty("headers");
  });

  it("redacts configured header keys when header logging is enabled", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: true, redactKeys: ["authorization"] }));
    app.get("/headers-redact", (c) => {
      c.get("logger").info("headers redact");
      return c.text("ok");
    });

    await app.request(
      createRequest("/headers-redact", {
        headers: {
          authorization: "Bearer secret",
        },
      }),
    );

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const req = entry.req as Record<string, unknown>;
    const headers = req.headers as Record<string, unknown>;

    expect(headers.authorization).toBe("[REDACTED]");
  });

  it("includes only allowlisted request headers", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ header: ["x-request-id", "authorization"] }));
    app.get("/headers-allowlist", (c) => {
      c.get("logger").info("headers allowlist");
      return c.text("ok");
    });

    await app.request(
      createRequest("/headers-allowlist", {
        headers: {
          "x-request-id": "trace-1",
          authorization: "Bearer secret",
          "x-ignored": "ignored",
        },
      }),
    );

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const req = entry.req as Record<string, unknown>;
    const headers = req.headers as Record<string, unknown>;

    expect(headers).toEqual({
      "x-request-id": "trace-1",
      authorization: "Bearer secret",
    });
  });

  it("emits a response-end access log with status and duration", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ autoLogging: "access" }));
    app.get("/created", (c) => c.json({ created: true }, 201));

    const response = await app.request(createRequest("/created"));
    expect(response.status).toBe(201);

    expect(console.log).toHaveBeenCalledTimes(1);
    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);

    expect(entry.msg).toBe("Request completed");
    expect(entry.level).toBe("info");
    expect(entry.status).toBe(201);
    expect(typeof entry.duration_ms).toBe("number");
    expect(entry).not.toHaveProperty("trace");
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

    const errorEntries = errorSpy.mock.calls
      .map((call: unknown[]) => {
        try {
          return parseLoggedEntry(call[0]);
        } catch {
          return undefined;
        }
      })
      .filter((entry: Record<string, unknown> | undefined): entry is Record<string, unknown> =>
        Boolean(entry),
      );

    const entry = errorEntries.find(
      (item: Record<string, unknown>) => item.msg === "Unhandled error",
    );
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("Unhandled error log entry not found");
    }
    const err = entry.err as Record<string, unknown>;

    expect(entry.msg).toBe("Unhandled error");
    expect(entry.level).toBe("error");
    expect(err.message).toBe("boom");
    expect(typeof entry.duration_ms).toBe("number");
  });

  it("auto-logs 5xx responses in error mode", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger({ autoLogging: "error" }));
    app.get("/503", (c) => c.text("down", 503));

    const response = await app.request(createRequest("/503"));
    expect(response.status).toBe(503);

    const entry = parseLoggedEntryFromCalls(errorSpy.mock.calls);

    expect(entry.msg).toBe("Request failed");
    expect(entry.level).toBe("error");
    expect(entry.status).toBe(503);
    expect(typeof entry.duration_ms).toBe("number");
    expect(entry).not.toHaveProperty("trace");
    expect(Object.keys(entry).slice(0, 3)).toEqual(["level", "msg", "time"]);
  });

  it("nests route-level payload under trace", async () => {
    const app = new Hono<{ Variables: LoggerVariables }>();
    app.use("*", logger());
    app.get("/custom-payload", (c) => {
      c.get("logger").info("custom payload", { name: "John Doe", age: 30 });
      return c.text("ok");
    });

    await app.request(createRequest("/custom-payload"));

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const trace = entry.trace as Record<string, unknown>;

    expect(trace.name).toBe("John Doe");
    expect(trace.age).toBe(30);
    expect(entry).not.toHaveProperty("name");
    expect(entry).not.toHaveProperty("age");
  });
});
