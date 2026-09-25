import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";
import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { getLogger } from "../../src/context";
import { createLogger, Logger, logger } from "../../src/index";
import {
  loggedCalls,
  loggedEntries,
  onlyEntry,
  spyOnConsole,
  type ConsoleSpies,
} from "../test-utils";

describe("per-request level, child loggers and context helpers", () => {
  let spies: ConsoleSpies;

  beforeEach(() => {
    spies = spyOnConsole();
  });

  it("types c.var.logger without declaring Variables", async () => {
    const app = new Hono();
    app.use("*", logger());
    app.get("/", (c) => {
      expectTypeOf(c.get("logger")).toEqualTypeOf<Logger>();
      expectTypeOf(c.var.logger).toEqualTypeOf<Logger>();
      c.var.logger.info("typed");
      return c.text("ok");
    });

    await app.request("/");

    expect(onlyEntry(spies).msg).toBe("typed");
  });

  it("resolves the level from env bindings per request", async () => {
    type AppEnv = { Bindings: { LOG_LEVEL?: string } };
    const app = new Hono<AppEnv>();
    app.use("*", logger<AppEnv>({ level: (c) => c.env.LOG_LEVEL }));
    app.get("/", (c) => {
      c.var.logger.debug("debug entry");
      c.var.logger.info("info entry");
      return c.text("ok");
    });

    await app.request("/", undefined, { LOG_LEVEL: "debug" });
    await app.request("/", undefined, { LOG_LEVEL: "warning" });
    await app.request("/", undefined, { LOG_LEVEL: "nonsense" });

    expect(loggedEntries(spies).map((entry) => entry.msg)).toEqual([
      "debug entry",
      "info entry",
      "info entry",
    ]);
  });

  it("falls back to info when the level resolver throws", async () => {
    const app = new Hono();
    app.use(
      "*",
      logger({
        level: () => {
          throw new Error("no env");
        },
      }),
    );
    app.get("/", (c) => {
      c.var.logger.debug("hidden");
      c.var.logger.info("shown");
      return c.text("ok");
    });

    await app.request("/");

    expect(onlyEntry(spies).msg).toBe("shown");
  });

  it("calls the level resolver at most once per request, and not when nothing logs", async () => {
    let calls = 0;
    const app = new Hono();
    app.use(
      "*",
      logger({
        level: () => {
          calls += 1;
          return "info";
        },
      }),
    );
    app.get("/quiet", (c) => c.text("ok"));
    app.get("/loud", (c) => {
      c.var.logger.info("one");
      c.var.logger.child({ part: "x" }).info("two");
      return c.text("ok");
    });

    await app.request("/quiet");
    expect(calls).toBe(0);

    await app.request("/loud");
    expect(calls).toBe(1);
  });

  it("child loggers add bindings without leaking back to the parent", async () => {
    const app = new Hono();
    app.use("*", logger({ generateTraceId: () => "trace-1" }));
    app.get("/", (c) => {
      const log = c.var.logger;
      log.setContext({ userId: "u-1" });
      const dbLog = log.child({ component: "db" });
      dbLog.setContext({ table: "orders" });
      log.setContext({ afterChild: true });

      dbLog.info("query");
      log.info("parent");
      return c.text("ok");
    });

    await app.request("/");

    const [child, parent] = loggedEntries(spies);
    expect(child).toMatchObject({
      trace_id: "trace-1",
      userId: "u-1",
      component: "db",
      table: "orders",
    });
    expect(child).not.toHaveProperty("afterChild");
    expect(parent).toMatchObject({ trace_id: "trace-1", userId: "u-1", afterChild: true });
    expect(parent).not.toHaveProperty("component");
    expect(parent).not.toHaveProperty("table");
  });

  it("child bindings are sanitized and cannot override reserved keys", () => {
    const log = createLogger({ redactKeys: ["token"], traceId: "t" });

    log.child({ token: "secret", trace_id: "fake", level: "emergency" }).info("child");

    const entry = onlyEntry(spies);
    expect(entry).toMatchObject({ level: "info", trace_id: "t", token: "[REDACTED]" });
  });

  it("createLogger works outside Hono with bindings", () => {
    const log = createLogger({ level: "debug", traceId: "job-1", bindings: { handler: "cron" } });

    log.debug("tick");

    expect(onlyEntry(spies)).toMatchObject({ level: "debug", trace_id: "job-1", handler: "cron" });
    expect(log.traceId).toBe("job-1");
  });

  it("getLogger returns the request logger through contextStorage", async () => {
    function deepHelper(): void {
      getLogger().info("from helper");
    }

    const app = new Hono();
    app.use("*", contextStorage());
    app.use("*", logger({ generateTraceId: () => "ctx-trace" }));
    app.get("/", async (c) => {
      await Promise.resolve();
      deepHelper();
      return c.text("ok");
    });

    await app.request("/");

    expect(onlyEntry(spies)).toMatchObject({ msg: "from helper", trace_id: "ctx-trace" });
  });

  it("getLogger falls back to a shared default logger outside a request", () => {
    const first = getLogger();

    first.info("outside");

    expect(getLogger()).toBe(first);
    expect(onlyEntry(spies)).not.toHaveProperty("req");
    expect(loggedCalls(spies)[0]?.method).toBe("info");
  });
});
