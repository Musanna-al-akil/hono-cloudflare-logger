import { beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../src/logger";
import type { LogEntry, LogSinkInfo } from "../../src/types";
import { loggedCalls, onlyEntry, spyOnConsole, type ConsoleSpies } from "../test-utils";

describe("Logger", () => {
  let spies: ConsoleSpies;

  beforeEach(() => {
    spies = spyOnConsole();
  });

  it("filters by minimum level", () => {
    const logger = new Logger({ level: "warning" });

    logger.info("ignored");
    logger.warning("written");
    logger.error("written-error");

    expect(loggedCalls(spies).map((call) => call.entry.msg)).toEqual(["written", "written-error"]);
  });

  it("maps levels to the console method Workers Logs uses as the event level", () => {
    const logger = new Logger({ level: "debug" });

    logger.debug("d");
    logger.info("i");
    logger.notice("n");
    logger.warning("w");
    logger.error("e");
    logger.critical("c");
    logger.alert("a");
    logger.emergency("em");

    expect(loggedCalls(spies).map((call) => [call.entry.level, call.method])).toEqual([
      ["debug", "debug"],
      ["info", "info"],
      ["notice", "info"],
      ["warning", "warn"],
      ["error", "error"],
      ["critical", "error"],
      ["alert", "error"],
      ["emergency", "error"],
    ]);
    expect(spies.log).not.toHaveBeenCalled();
  });

  it("passes a plain object to the console by default", () => {
    const logger = new Logger();

    logger.info("object mode", { userId: "u-1" });

    const raw = spies.info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof raw).toBe("object");
    expect(raw.msg).toBe("object mode");
  });

  it("writes one JSON string per entry with format json", () => {
    const logger = new Logger({ format: "json" });

    logger.info("json mode", { userId: "u-1" });

    const raw = spies.info.mock.calls[0]?.[0];
    expect(typeof raw).toBe("string");
    expect(String(raw).endsWith("\n")).toBe(false);
    expect(JSON.parse(String(raw))).toMatchObject({ level: "info", msg: "json mode" });
  });

  it("writes a single escaped line with format pretty", () => {
    const logger = new Logger({ format: "pretty", timestamp: false });

    logger.warning("line\nbreak", { userId: "u-1" });

    const raw = String(spies.warn.mock.calls[0]?.[0]);
    expect(raw).toBe('WARNING   line\\u000abreak data={"userId":"u-1"}');
  });

  it("omits time when timestamp is disabled", () => {
    const logger = new Logger({ timestamp: false });

    logger.info("no time");

    expect(onlyEntry(spies)).not.toHaveProperty("time");
  });

  it("sends entries to a custom sink instead of the console", () => {
    const received: Array<[LogEntry, LogSinkInfo]> = [];
    const logger = new Logger({ sink: (entry, info) => received.push([entry, info]) });

    logger.warning("to sink", { a: 1 });

    expect(received).toHaveLength(1);
    expect(received[0]?.[0]).toMatchObject({ level: "warning", msg: "to sink" });
    expect(received[0]?.[1]).toEqual({ level: "warning", priority: 3 });
    expect(loggedCalls(spies)).toHaveLength(0);
  });

  it("never throws when the sink throws", () => {
    const logger = new Logger({
      sink: () => {
        throw new Error("sink down");
      },
    });

    expect(() => logger.info("lost")).not.toThrow();

    const fallback = onlyEntry(spies);
    expect(fallback).toMatchObject({
      level: "error",
      msg: "Logger failed to write entry",
      original_level: "info",
      original_msg: "lost",
      reason: "sink down",
    });
  });

  it("rejects unknown levels and formats at construction", () => {
    expect(() => new Logger({ level: "verbose" as never })).toThrow(TypeError);
    expect(() => new Logger({ format: "xml" as never })).toThrow(TypeError);
    expect(() => new Logger({ maxStringLength: 0 })).toThrow(TypeError);
  });

  it("merges mutable context with last write wins and nests call data under data", () => {
    const logger = new Logger({ level: "debug", traceId: "trace-1" });

    logger.setContext({ userId: "u-1", role: "user" });
    logger.setContext({ role: "admin", sessionId: "s-1" });
    logger.info("context merge", { route: "/login" });

    const entry = onlyEntry(spies);
    expect(entry.trace_id).toBe("trace-1");
    expect(entry.userId).toBe("u-1");
    expect(entry.role).toBe("admin");
    expect(entry.sessionId).toBe("s-1");
    expect(entry).not.toHaveProperty("route");
    expect(entry.data).toEqual({ route: "/login" });
  });

  it("redacts configured keys deeply and case-insensitively", () => {
    const logger = new Logger({ level: "debug", redactKeys: ["password", "token"] });

    logger.info("redaction", {
      password: "plain",
      nested: { token: "nested-token", keep: true },
      arr: [{ Password: "case-insensitive" }],
    });

    expect(onlyEntry(spies).data).toEqual({
      password: "[REDACTED]",
      nested: { token: "[REDACTED]", keep: true },
      arr: [{ Password: "[REDACTED]" }],
    });
  });

  it("matches redact keys regardless of case and separators", () => {
    const logger = new Logger({ redactKeys: ["apiKey", "access_token"] });

    logger.info("separators", {
      api_key: "a",
      "API-KEY": "b",
      apikey: "c",
      accessToken: "d",
      "access.token": "e",
      keep: "f",
    });

    expect(onlyEntry(spies).data).toEqual({
      api_key: "[REDACTED]",
      "API-KEY": "[REDACTED]",
      apikey: "[REDACTED]",
      accessToken: "[REDACTED]",
      "access.token": "[REDACTED]",
      keep: "f",
    });
  });

  it("uses a custom censor", () => {
    const logger = new Logger({ redactKeys: ["password"], censor: "***" });

    logger.info("censor", { password: "plain" });

    expect(onlyEntry(spies).data).toEqual({ password: "***" });
  });

  it("does not mutate the caller's objects when redacting", () => {
    const logger = new Logger({ redactKeys: ["token"] });
    const payload = { token: "secret", nested: { token: "inner" } };

    logger.info("immutable", payload);

    expect(payload).toEqual({ token: "secret", nested: { token: "inner" } });
  });

  it("replaces circular references instead of dropping the entry", () => {
    const logger = new Logger({ level: "debug", redactKeys: ["token"] });
    const circular: Record<string, unknown> = { token: "secret", keep: 1 };
    circular.self = circular;

    logger.info("circular", circular);

    expect(onlyEntry(spies).data).toEqual({
      token: "[REDACTED]",
      keep: 1,
      self: "[Circular]",
    });
  });

  it("keeps shared (non-circular) references", () => {
    const logger = new Logger();
    const shared = { id: 1 };

    logger.info("shared", { a: shared, b: shared });

    expect(onlyEntry(spies).data).toEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  it("converts values JSON cannot represent", () => {
    const logger = new Logger();

    logger.info("values", {
      big: 10n,
      fn: () => 1,
      map: new Map<unknown, unknown>([
        ["a", 1],
        [2, "b"],
      ]),
      set: new Set([1, 2]),
      bytes: new Uint8Array(4),
      headers: new Headers({ "x-a": "1" }),
      date: new Date("2026-01-01T00:00:00.000Z"),
      url: new URL("https://example.com/path"),
    });

    expect(onlyEntry(spies).data).toEqual({
      big: "10",
      map: { a: 1, "2": "b" },
      set: [1, 2],
      bytes: "[Uint8Array(4)]",
      headers: { "x-a": "1" },
      date: "2026-01-01T00:00:00.000Z",
      url: "https://example.com/path",
    });
  });

  it("caps nesting depth", () => {
    const logger = new Logger();
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 12; index += 1) {
      deep = { next: deep };
    }

    logger.info("deep", deep);

    const serialized = JSON.stringify(onlyEntry(spies).data);
    expect(serialized).toContain('"[Object]"');
    expect(serialized).not.toContain("leaf");
  });

  it("truncates oversized strings", () => {
    const logger = new Logger({ maxStringLength: 10 });

    logger.info("long", { body: "x".repeat(25) });

    expect(onlyEntry(spies).data).toEqual({ body: `${"x".repeat(10)}…[truncated 15 chars]` });
  });

  it("survives a throwing toJSON", () => {
    const logger = new Logger();
    const hostile = {
      toJSON() {
        throw new Error("nope");
      },
    };

    logger.info("hostile", { hostile });

    expect(onlyEntry(spies).data).toEqual({ hostile: "[Unserializable]" });
  });

  it("serializes the error and keeps call data separate", () => {
    const logger = new Logger({ level: "debug" });

    logger.error("failed", new TypeError("boom"), { op: "create" });

    const entry = onlyEntry(spies);
    expect(entry.err).toMatchObject({ name: "TypeError", message: "boom" });
    expect(typeof (entry.err as Record<string, unknown>).stack).toBe("string");
    expect(entry.data).toEqual({ op: "create" });
  });

  it("accepts catch-clause values without casting", () => {
    const logger = new Logger();

    try {
      throw "plain string";
    } catch (error) {
      logger.error("caught", error);
    }

    expect(onlyEntry(spies).err).toEqual({ name: "NonError", message: "plain string" });
  });

  it("supports explicit flat placement override", () => {
    const logger = new Logger({ level: "debug" });

    logger.info("flat data", { status: 200 }, { placement: "flat" });

    const entry = onlyEntry(spies);
    expect(entry.status).toBe(200);
    expect(entry).not.toHaveProperty("data");
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
      { level: "critical", msg: "flat-msg", time: "flat-time", status: 200 },
      { placement: "flat" },
    );

    const entry = onlyEntry(spies);
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("canonical");
    expect(entry.time).not.toBe("context-time");
    expect(entry.time).not.toBe("flat-time");
    expect(entry.status).toBe(200);
  });

  it("orders keys level, msg, time, trace_id, context, data, err", () => {
    const logger = new Logger({ level: "debug", traceId: "trace-1" });
    logger.setContext({ userId: "u-1" });

    logger.error("ordered", new Error("x"), { route: "/login" });

    expect(Object.keys(onlyEntry(spies))).toEqual([
      "level",
      "msg",
      "time",
      "trace_id",
      "userId",
      "data",
      "err",
    ]);
  });

  it("ignores reserved keys in context and flat data", () => {
    const logger = new Logger({ traceId: "real" });
    logger.setContext({ trace_id: "fake", data: "fake", err: "fake", req: "fake" });

    logger.info("reserved", { req: "flat-fake" }, { placement: "flat" });

    const entry = onlyEntry(spies);
    expect(entry.trace_id).toBe("real");
    expect(entry).not.toHaveProperty("data");
    expect(entry).not.toHaveProperty("err");
    expect(entry).not.toHaveProperty("req");
  });

  it("reports but does not throw when writing fails unexpectedly", () => {
    const logger = new Logger();
    spies.info.mockImplementation(() => {
      throw new Error("console broke");
    });

    expect(() => logger.info("will fail")).not.toThrow();
    expect(spies.error).toHaveBeenCalledTimes(1);
  });

  it("does not call Date for filtered entries", () => {
    const logger = new Logger({ level: "error" });
    const dateSpy = vi.spyOn(Date, "now");

    logger.info("filtered");

    expect(dateSpy).not.toHaveBeenCalled();
  });
});
