import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/logger";
import { onlyEntry, spyOnConsole, type ConsoleSpies } from "../test-utils";

describe("error serialization", () => {
  let spies: ConsoleSpies;

  beforeEach(() => {
    spies = spyOnConsole();
  });

  function logError(err: unknown, options: ConstructorParameters<typeof Logger>[0] = {}) {
    for (const spy of Object.values(spies)) {
      spy.mockClear();
    }
    new Logger(options).error("failed", err);
    return onlyEntry(spies).err as Record<string, unknown>;
  }

  it("includes name, message, stack, and string/number codes", () => {
    const err = Object.assign(new RangeError("out of range"), { code: "E_RANGE" });

    const serialized = logError(err);

    expect(serialized.name).toBe("RangeError");
    expect(serialized.message).toBe("out of range");
    expect(serialized.code).toBe("E_RANGE");
    expect(serialized.stack).toContain("RangeError: out of range");
  });

  it("keeps the HTTP status of Hono's HTTPException", () => {
    const serialized = logError(new HTTPException(404, { message: "not found" }));

    expect(serialized).toMatchObject({ message: "not found", status: 404 });
  });

  it("leaves other own properties out", () => {
    const err = Object.assign(new Error("boom"), { requestBody: { password: "x" } });

    expect(logError(err)).not.toHaveProperty("requestBody");
  });

  it("follows the cause chain up to a bounded depth", () => {
    const root = new Error("level 0", {
      cause: new Error("level 1", {
        cause: new Error("level 2", {
          cause: new Error("level 3", { cause: new Error("level 4") }),
        }),
      }),
    });

    const serialized = logError(root);
    const level1 = serialized.cause as Record<string, unknown>;
    const level2 = level1.cause as Record<string, unknown>;
    const level3 = level2.cause as Record<string, unknown>;

    expect(level1.message).toBe("level 1");
    expect(level2.message).toBe("level 2");
    expect(level3.message).toBe("level 3");
    expect(level3.cause).toBe("[Cause depth exceeded]");
  });

  it("sanitizes non-Error causes", () => {
    const serialized = logError(new Error("wrapped", { cause: { token: "t", retry: 1n } }), {
      redactKeys: ["token"],
    });

    expect(serialized.cause).toEqual({ token: "[REDACTED]", retry: "1" });
  });

  it("lists AggregateError members", () => {
    const aggregate = new AggregateError([new Error("a"), "b"], "many failed");

    const serialized = logError(aggregate);

    expect(serialized.name).toBe("AggregateError");
    expect(serialized.errors).toEqual([
      expect.objectContaining({ name: "Error", message: "a" }),
      { name: "NonError", message: "b" },
    ]);
  });

  it("describes non-Error values", () => {
    expect(logError(42)).toEqual({ name: "NonError", message: "42" });
    expect(logError(null)).toEqual({ name: "NonError", message: "null" });
    expect(logError({ message: "shaped like an error" })).toEqual({
      name: "NonError",
      message: "shaped like an error",
    });
    expect(logError({ reason: "custom" })).toEqual({
      name: "NonError",
      message: '{"reason":"custom"}',
    });
  });

  it("truncates huge messages and stacks", () => {
    const serialized = logError(new Error("x".repeat(50)), { maxStringLength: 10 });

    expect(serialized.message).toBe(`${"x".repeat(10)}…[truncated]`);
    expect(String(serialized.stack).length).toBeLessThanOrEqual(10 + "…[truncated]".length);
  });

  it("serializes errors nested inside data", () => {
    new Logger().info("nested", { failure: new TypeError("inner") });

    expect((onlyEntry(spies).data as Record<string, unknown>).failure).toMatchObject({
      name: "TypeError",
      message: "inner",
    });
  });
});
