import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/index";
import { MAX_BUFFERED_ENTRIES } from "../../src/logger";
import type { LoggerConfig } from "../../src/types";
import {
  loggedCalls,
  loggedEntries,
  onlyEntry,
  spyOnConsole,
  type ConsoleSpies,
} from "../test-utils";

function createApp(config: LoggerConfig): Hono {
  const app = new Hono();
  app.use("*", logger(config));
  app.get("/ok", (c) => c.text("ok"));
  app.get("/missing", (c) => c.text("missing", 404));
  app.get("/unauthorized", () => {
    throw new HTTPException(401, { message: "no token" });
  });
  app.get("/boom", () => {
    throw new TypeError("boom");
  });
  app.get("/down", (c) => c.text("down", 503));
  app.get("/zero", () => {
    throw 0;
  });
  return app;
}

describe("automatic request entries", () => {
  let spies: ConsoleSpies;

  beforeEach(() => {
    spies = spyOnConsole();
  });

  describe("access mode", () => {
    it("uses info for success, warning for 4xx and error for 5xx", async () => {
      const app = createApp({ autoLogging: "access" });

      for (const path of ["/ok", "/missing", "/unauthorized", "/down", "/boom"]) {
        await app.request(path);
      }

      const summary = loggedCalls(spies)
        .filter((call) => call.entry.status !== undefined)
        .map((call) => [call.method, call.entry.level, call.entry.status, call.entry.msg]);
      expect(summary).toEqual([
        ["info", "info", 200, "Request completed"],
        ["warn", "warning", 404, "Request completed"],
        ["warn", "warning", 401, "Request completed"],
        ["error", "error", 503, "Request failed"],
        ["error", "error", 500, "Unhandled error"],
      ]);
    });

    it("attaches the error only to failed requests", async () => {
      const app = createApp({ autoLogging: "access" });

      await app.request("/unauthorized");
      await app.request("/boom");

      const [clientError, serverError] = loggedEntries(spies).filter(
        (entry) => entry.status !== undefined,
      );
      expect(clientError).not.toHaveProperty("err");
      expect(serverError?.err).toMatchObject({ name: "TypeError", message: "boom" });
    });

    it("samples successful info entries but keeps warnings and errors", async () => {
      const app = createApp({ autoLogging: "access", sampleRate: 0 });

      await app.request("/ok");
      await app.request("/missing");
      await app.request("/down");

      expect(loggedEntries(spies).map((entry) => entry.status)).toEqual([404, 503]);
    });

    it("keeps an info entry when the random draw falls under sampleRate", async () => {
      const app = createApp({ autoLogging: "access", sampleRate: 0.5 });
      const random = vi.spyOn(Math, "random");

      random.mockReturnValueOnce(0.3);
      await app.request("/ok");
      random.mockReturnValueOnce(0.7);
      await app.request("/ok");

      expect(loggedEntries(spies)).toHaveLength(1);
    });

    it("skips automatic entries but keeps the request logger", async () => {
      const app = new Hono();
      app.use("*", logger({ autoLogging: "access", skip: (c) => c.req.path === "/health" }));
      app.get("/health", (c) => {
        c.var.logger.warning("manual entry still works");
        return c.text("ok");
      });

      await app.request("/health");

      expect(onlyEntry(spies).msg).toBe("manual entry still works");
    });

    it("treats a throwing skip predicate as false", async () => {
      const app = createApp({
        autoLogging: "access",
        skip: () => {
          throw new Error("bad predicate");
        },
      });

      await app.request("/ok");

      expect(onlyEntry(spies).msg).toBe("Request completed");
    });
  });

  describe("error mode", () => {
    it("ignores client errors, including HTTPException 4xx", async () => {
      const app = createApp({ autoLogging: "error" });

      await app.request("/ok");
      await app.request("/missing");
      await app.request("/unauthorized");

      expect(loggedCalls(spies)).toHaveLength(0);
    });

    it("ignores errors that onError maps to a client status", async () => {
      const app = new Hono();
      app.use("*", logger({ autoLogging: "error" }));
      app.onError((_error, c) => c.json({ error: "invalid" }, 422));
      app.get("/", () => {
        throw new Error("validation failed");
      });

      const response = await app.request("/");

      expect(response.status).toBe(422);
      expect(loggedCalls(spies)).toHaveLength(0);
    });

    it("logs thrown errors and 5xx responses", async () => {
      const app = createApp({ autoLogging: "error" });

      await app.request("/boom");
      await app.request("/down");

      expect(
        loggedEntries(spies)
          .filter((entry) => entry.status !== undefined)
          .map((entry) => [entry.msg, entry.status]),
      ).toEqual([
        ["Unhandled error", 500],
        ["Request failed", 503],
      ]);
    });
  });

  it("rethrows falsy non-Error throws and logs them as failures", async () => {
    const app = createApp({ autoLogging: "error" });

    await expect(app.request("/zero")).rejects.toBe(0);

    expect(onlyEntry(spies)).toMatchObject({
      level: "error",
      msg: "Unhandled error",
      status: 500,
      err: { name: "NonError", message: "0" },
    });
  });

  it("rejects invalid configuration up front", () => {
    expect(() => logger({ sampleRate: 2 })).toThrow(TypeError);
    expect(() => logger({ sampleRate: Number.NaN })).toThrow(TypeError);
    expect(() => logger({ autoLogging: "loud" as never })).toThrow(TypeError);
    expect(() => logger({ level: "verbose" as never })).toThrow(TypeError);
  });

  describe("bufferUntilError", () => {
    function createBufferedApp(config: LoggerConfig = {}): Hono {
      const app = new Hono();
      app.use("*", logger({ level: "debug", bufferUntilError: true, ...config }));
      app.get("/ok", (c) => {
        c.var.logger.debug("step 1");
        c.var.logger.info("step 2");
        c.var.logger.warning("slow upstream");
        return c.text("ok");
      });
      app.get("/fail", (c) => {
        c.var.logger.debug("step 1");
        c.var.logger.info("step 2");
        return c.text("down", 502);
      });
      app.get("/error-log", (c) => {
        c.var.logger.info("before");
        c.var.logger.error("payment declined", new Error("card"));
        c.var.logger.info("after");
        return c.text("ok");
      });
      return app;
    }

    it("drops buffered entries for successful requests but writes warnings", async () => {
      await createBufferedApp().request("/ok");

      expect(loggedEntries(spies).map((entry) => entry.msg)).toEqual(["slow upstream"]);
    });

    it("still writes the access entry for successful requests", async () => {
      await createBufferedApp({ autoLogging: "access" }).request("/ok");

      expect(loggedCalls(spies).map((call) => [call.method, call.entry.msg])).toEqual([
        ["warn", "slow upstream"],
        ["info", "Request completed"],
      ]);
    });

    it("writes buffered entries before the access entry of a failed request", async () => {
      await createBufferedApp({ autoLogging: "access" }).request("/fail");

      expect(loggedEntries(spies).map((entry) => entry.msg)).toEqual([
        "step 1",
        "step 2",
        "Request failed",
      ]);
    });

    it("writes buffered entries in order when the request fails", async () => {
      await createBufferedApp({ autoLogging: "error" }).request("/fail");

      expect(loggedCalls(spies).map((call) => [call.method, call.entry.msg])).toEqual([
        ["debug", "step 1"],
        ["info", "step 2"],
        ["error", "Request failed"],
      ]);
    });

    it("flushes on failure even without automatic entries", async () => {
      await createBufferedApp({ autoLogging: "silent" }).request("/fail");

      expect(loggedEntries(spies).map((entry) => entry.msg)).toEqual(["step 1", "step 2"]);
    });

    it("flushes when an error-level entry is written and stops buffering", async () => {
      await createBufferedApp().request("/error-log");

      expect(loggedEntries(spies).map((entry) => entry.msg)).toEqual([
        "before",
        "payment declined",
        "after",
      ]);
    });

    it("keeps the newest entries and reports how many were dropped", async () => {
      const app = new Hono();
      app.use("*", logger({ bufferUntilError: true, autoLogging: "error" }));
      app.get("/", (c) => {
        for (let index = 0; index < MAX_BUFFERED_ENTRIES + 5; index += 1) {
          c.var.logger.info(`entry ${index}`);
        }
        return c.text("down", 500);
      });

      await app.request("/");

      const messages = loggedEntries(spies).map((entry) => entry.msg);
      expect(messages[0]).toBe("Buffered log entries dropped");
      expect(loggedEntries(spies)[0]?.dropped_count).toBe(5);
      expect(messages[1]).toBe("entry 5");
      expect(messages).toHaveLength(1 + MAX_BUFFERED_ENTRIES + 1);
    });
  });
});
