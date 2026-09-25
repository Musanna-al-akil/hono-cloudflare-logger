import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";
import { beforeEach, describe, expect, it } from "vitest";
import { getLogger } from "../../src/context";
import { createLogger, logger, type LogEntry, type LoggerConfig } from "../../src/index";
import { loggedCalls, onlyEntry, spyOnConsole, type ConsoleSpies } from "../test-utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function dispatch(app: Hono, request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(request, {}, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function createApp(config: LoggerConfig): Hono {
  const app = new Hono();
  app.use("*", logger(config));
  app.get("/users/:id", (c) => {
    c.var.logger.info("loaded user");
    return c.text("ok");
  });
  return app;
}

describe("workerd runtime", () => {
  let spies: ConsoleSpies;

  beforeEach(() => {
    spies = spyOnConsole();
  });

  it("maps syslog levels to the console methods Workers Logs reads", () => {
    const log = createLogger({ level: "debug" });

    log.debug("d");
    log.info("i");
    log.notice("n");
    log.warning("w");
    log.error("e");
    log.emergency("em");

    expect(loggedCalls(spies).map((call) => [call.method, call.entry.level])).toEqual([
      ["debug", "debug"],
      ["info", "info"],
      ["info", "notice"],
      ["warn", "warning"],
      ["error", "error"],
      ["error", "emergency"],
    ]);
  });

  it("passes a plain, structured-cloneable object to the console by default", () => {
    createLogger().info("hello", { count: 1 });

    const entry = spies.info.mock.calls[0]?.[0] as LogEntry;
    expect(typeof entry).toBe("object");
    expect(structuredClone(entry)).toEqual(entry);
  });

  it("picks request.cf properties from a real workerd request", async () => {
    const app = createApp({ includeCfProperties: ["colo", "country", "missing"] });
    const request = new Request("https://example.com/users/42", {
      cf: { colo: "SIN", country: "SG", asn: 13335 },
    });

    await dispatch(app, request);

    expect(onlyEntry(spies).req).toEqual({
      method: "GET",
      path: "/users/42",
      route: "/users/:id",
      cf: { colo: "SIN", country: "SG" },
    });
  });

  it("generates trace ids with crypto.randomUUID and prefers cf-ray over it", async () => {
    const app = createApp({});

    await dispatch(app, new Request("https://example.com/users/1"));
    await dispatch(
      app,
      new Request("https://example.com/users/2", { headers: { "cf-ray": "8f1c2a3b4c5d6e7f-SIN" } }),
    );

    const [generated, fromRay] = loggedCalls(spies).map((call) => call.entry.trace_id);
    expect(generated).toMatch(UUID);
    expect(fromRay).toBe("8f1c2a3b4c5d6e7f-SIN");
  });

  it("flushes a sink through the real executionCtx.waitUntil", async () => {
    const written: string[] = [];
    let flushed = false;
    const app = createApp({
      sink: {
        write: (entry) => written.push(entry.msg),
        flush: async () => {
          await Promise.resolve();
          flushed = true;
        },
      },
    });

    await dispatch(app, new Request("https://example.com/users/7"));

    expect(written).toEqual(["loaded user"]);
    expect(flushed).toBe(true);
  });

  it("echoes the trace id on the response", async () => {
    const app = createApp({ responseHeader: "x-request-id" });

    const response = await dispatch(
      app,
      new Request("https://example.com/users/3", { headers: { "x-request-id": "req-abc" } }),
    );

    expect(response.headers.get("x-request-id")).toBe("req-abc");
    expect(onlyEntry(spies).trace_id).toBe("req-abc");
  });

  it("getLogger reaches the request logger across awaits with nodejs_compat", async () => {
    const app = new Hono();
    app.use("*", contextStorage());
    app.use("*", logger({ generateTraceId: () => "als-trace" }));
    app.get("/", async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      getLogger().info("from helper");
      return c.text("ok");
    });

    await dispatch(app, new Request("https://example.com/"));

    expect(onlyEntry(spies)).toMatchObject({ msg: "from helper", trace_id: "als-trace" });
  });

  it("logs 5xx access entries with the serialized error", async () => {
    const app = new Hono();
    app.use("*", logger({ autoLogging: "access" }));
    app.get("/", () => {
      throw new TypeError("boom");
    });

    const response = await dispatch(app, new Request("https://example.com/"));

    expect(response.status).toBe(500);
    // Hono's default onError also calls console.error(error); find our entry.
    const call = loggedCalls(spies).find((logged) => logged.entry.status !== undefined);
    expect(call?.method).toBe("error");
    expect(call?.entry).toMatchObject({
      level: "error",
      msg: "Unhandled error",
      status: 500,
      err: { name: "TypeError", message: "boom" },
    });
    expect(typeof call?.entry.duration_ms).toBe("number");
  });
});
