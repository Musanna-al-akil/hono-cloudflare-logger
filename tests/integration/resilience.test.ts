import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/index";
import { onlyEntry, spyOnConsole, type ConsoleSpies } from "../test-utils";

const route = vi.hoisted(() => ({ throws: false }));

// Simulates a second copy of hono whose helper cannot read this request's match results.
vi.mock("hono/route", async (importOriginal) => {
  const original = await importOriginal<typeof import("hono/route")>();
  return {
    ...original,
    routePath: (...args: Parameters<typeof original.routePath>) => {
      if (route.throws) {
        throw new TypeError("Cannot read properties of undefined (reading '0')");
      }
      return original.routePath(...args);
    },
  };
});

describe("request metadata resilience", () => {
  let spies: ConsoleSpies;

  beforeEach(() => {
    spies = spyOnConsole();
    route.throws = false;
  });

  it("falls back to the request's own route getter when hono/route fails", async () => {
    route.throws = true;
    const app = new Hono();
    app.use("*", logger());
    app.get("/users/:id", (c) => {
      c.var.logger.info("loaded");
      return c.text("ok");
    });

    await app.request("/users/42");

    expect(onlyEntry(spies)).toMatchObject({
      msg: "loaded",
      req: { method: "GET", path: "/users/42", route: "/users/:id" },
    });
  });

  it("writes the entry without req when request metadata cannot be built", async () => {
    const app = new Hono();
    app.use("*", logger({ header: true, generateTraceId: () => "generated" }));
    app.get("/", (c) => {
      Object.defineProperty(c.req.raw, "headers", {
        get() {
          throw new Error("headers unavailable");
        },
      });
      c.var.logger.info("still logged");
      return c.text("ok");
    });

    await app.request("/");

    const entry = onlyEntry(spies);
    expect(entry.msg).toBe("still logged");
    expect(entry.trace_id).toBe("generated");
    expect(entry).not.toHaveProperty("req");
  });
});
