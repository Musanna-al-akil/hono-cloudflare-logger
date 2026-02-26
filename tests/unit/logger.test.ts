import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../src/logger";
import { parseLoggedEntryFromCalls } from "../test-utils";

describe("Logger", () => {
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

  it("filters by minimum level", () => {
    const logger = new Logger({ level: "warning" });

    logger.info("ignored");
    logger.warning("written");
    logger.error("written-error");

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("routes lower levels to console.log and error+ to console.error", () => {
    const logger = new Logger({ level: "debug" });

    logger.info("info");
    logger.critical("critical");

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);

    const infoLog = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const criticalLog = parseLoggedEntryFromCalls(errorSpy.mock.calls);

    expect(infoLog.level).toBe("info");
    expect(criticalLog.level).toBe("critical");
  });

  it("merges mutable context with last write wins and nests call data under trace", () => {
    const logger = new Logger({ level: "debug", traceId: "trace-1" });

    logger.setContext({ userId: "u-1", role: "user" });
    logger.setContext({ role: "admin", sessionId: "s-1" });
    logger.info("context merge", { route: "/login" });

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const trace = entry.trace as Record<string, unknown>;
    expect(entry.trace_id).toBe("trace-1");
    expect(entry.userId).toBe("u-1");
    expect(entry.role).toBe("admin");
    expect(entry.sessionId).toBe("s-1");
    expect(entry).not.toHaveProperty("route");
    expect(trace.route).toBe("/login");
  });

  it("redacts configured keys deeply and case-insensitively", () => {
    const logger = new Logger({ level: "debug", redactKeys: ["password", "token"] });

    logger.info("redaction", {
      password: "plain",
      nested: { token: "nested-token", keep: true },
      arr: [{ Password: "case-insensitive" }],
    });

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const trace = entry.trace as Record<string, unknown>;
    const nested = trace.nested as Record<string, unknown>;
    const arr = trace.arr as Array<Record<string, unknown>>;

    expect(trace.password).toBe("[REDACTED]");
    expect(nested.token).toBe("[REDACTED]");
    expect(nested.keep).toBe(true);
    expect(arr[0]?.Password).toBe("[REDACTED]");
  });

  it("falls back to static error for circular payloads while redacting", () => {
    const logger = new Logger({ level: "debug", redactKeys: ["token"] });
    const circular: Record<string, unknown> = { token: "secret" };
    circular.self = circular;

    logger.info("circular-redact", circular);

    expect(console.log).toHaveBeenCalledTimes(0);
    expect(console.error).toHaveBeenCalledTimes(1);

    const entry = parseLoggedEntryFromCalls(errorSpy.mock.calls);
    expect(entry).toEqual({
      level: "error",
      msg: "Logger failed to serialize object",
    });
  });

  it("serializes Error with only message and stack", () => {
    const logger = new Logger({ level: "debug" });
    const err = new Error("boom");
    (err as Error & { code?: string }).code = "E_BANG";

    logger.error("failed", err, { op: "create" });

    const entry = parseLoggedEntryFromCalls(errorSpy.mock.calls);
    const errorPart = entry.err as Record<string, unknown>;
    const trace = entry.trace as Record<string, unknown>;

    expect(errorPart.message).toBe("boom");
    expect(typeof errorPart.stack).toBe("string");
    expect(errorPart).not.toHaveProperty("code");
    expect(trace.op).toBe("create");
  });

  it("supports explicit flat placement override", () => {
    const logger = new Logger({ level: "debug" });

    logger.info("flat data", { status: 200 }, { dataPlacement: "flat" });

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    expect(entry.status).toBe(200);
    expect(entry).not.toHaveProperty("trace");
  });

  it("does not allow context or flat data to override level/msg/time", () => {
    const logger = new Logger({ level: "debug" });
    logger.setContext({
      level: "emergency",
      msg: "context-msg",
      time: "context-time",
    });

    logger.info(
      "canonical",
      {
        level: "critical",
        msg: "flat-msg",
        time: "flat-time",
        status: 200,
      },
      { dataPlacement: "flat" },
    );

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("canonical");
    expect(typeof entry.time).toBe("string");
    expect(entry.time).not.toBe("context-time");
    expect(entry.time).not.toBe("flat-time");
    expect(entry.status).toBe(200);
  });

  it("preserves non-plain objects while redacting configured keys", () => {
    const logger = new Logger({ level: "debug", redactKeys: ["password"] });
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const url = new URL("https://example.com/path");

    logger.info("keep object types", {
      createdAt,
      url,
      password: "secret",
    });

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const trace = entry.trace as Record<string, unknown>;

    expect(trace.createdAt).toBe(createdAt.toISOString());
    expect(trace.url).toBe(url.href);
    expect(trace.password).toBe("[REDACTED]");
  });

  it("serializes keys with level,msg,trace,time prefix when trace exists", () => {
    const logger = new Logger({ level: "debug", traceId: "trace-1" });
    logger.setContext({ userId: "u-1" });

    logger.info("ordered trace", { route: "/login" });

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const keys = Object.keys(entry);

    expect(keys.slice(0, 4)).toEqual(["level", "msg", "trace", "time"]);
    expect(keys.indexOf("trace_id")).toBeGreaterThan(3);
    expect(keys.indexOf("userId")).toBeGreaterThan(3);
  });

  it("serializes keys with level,msg,time prefix when trace is absent", () => {
    const logger = new Logger({ level: "debug", traceId: "trace-1" });

    logger.info("ordered no trace");

    const entry = parseLoggedEntryFromCalls(logSpy.mock.calls);
    const keys = Object.keys(entry);

    expect(keys.slice(0, 3)).toEqual(["level", "msg", "time"]);
    expect(keys.indexOf("trace_id")).toBeGreaterThan(2);
  });

  it("falls back to static error when serialization fails for circular objects", () => {
    const logger = new Logger({ level: "debug" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.info("will-fail", circular);

    expect(console.log).toHaveBeenCalledTimes(0);
    expect(console.error).toHaveBeenCalledTimes(1);

    const entry = parseLoggedEntryFromCalls(errorSpy.mock.calls);
    expect(entry).toEqual({
      level: "error",
      msg: "Logger failed to serialize object",
    });
  });

  it("writes newline-terminated NDJSON lines", () => {
    const logger = new Logger({ level: "debug" });

    logger.notice("ndjson");

    const rawCall = logSpy.mock.calls[0];
    expect(rawCall).toBeDefined();
    const raw = rawCall?.[0];
    expect(String(raw).endsWith("\n")).toBe(true);
    expect(() => JSON.parse(String(raw).trimEnd())).not.toThrow();
  });
});
