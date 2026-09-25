import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWriter, formatPretty, reportWriteFailure } from "../../src/sink";
import type { LogEntry } from "../../src/types";
import { spyOnConsole, toEntry, type ConsoleSpies } from "../test-utils";

describe("createWriter", () => {
  let spies: ConsoleSpies;

  beforeEach(() => {
    spies = spyOnConsole();
  });

  it("reports entries that JSON cannot serialize without throwing", () => {
    const write = createWriter("json", undefined);
    const entry = { level: "info", msg: "big", trace_id: "t-1", n: 1n } as LogEntry;

    expect(() => write(entry, 1)).not.toThrow();

    expect(spies.info).not.toHaveBeenCalled();
    expect(toEntry(spies.error.mock.calls[0]?.[0])).toMatchObject({
      msg: "Logger failed to write entry",
      original_level: "info",
      original_msg: "big",
      trace_id: "t-1",
    });
  });

  it("falls back to console.error for an out-of-range priority", () => {
    createWriter("object", undefined)({ level: "emergency", msg: "x" }, 99);
    createWriter("json", undefined)({ level: "emergency", msg: "y" }, 99);
    createWriter("pretty", undefined)({ level: "emergency", msg: "z" }, 99);

    expect(spies.error).toHaveBeenCalledTimes(3);
  });

  it("calls a sink object's write with the object as this", () => {
    const sink = {
      entries: [] as string[],
      write(entry: LogEntry): void {
        this.entries.push(entry.msg);
      },
    };

    createWriter("object", sink)({ level: "info", msg: "bound" }, 1);

    expect(sink.entries).toEqual(["bound"]);
  });
});

describe("formatPretty", () => {
  it("prints the clock time, padded level, escaped message and fields", () => {
    const line = formatPretty({
      level: "warning",
      msg: "line\nbreak\u001b[31m",
      time: "2026-09-25T10:11:12.345Z",
      trace_id: "t-1",
      skipped: undefined,
      data: { a: "\n" },
    });

    expect(line).toBe(
      '10:11:12.345 WARNING   line\\u000abreak\\u001b[31m trace_id="t-1" data={"a":"\\n"}',
    );
    expect(line).not.toMatch(/\n/);
  });
});

describe("reportWriteFailure", () => {
  it("stringifies non-Error reasons and truncates long messages", () => {
    const spies = spyOnConsole();

    reportWriteFailure({ level: "info", msg: "m".repeat(2000) }, "disk full");

    const report = toEntry(spies.error.mock.calls[0]?.[0]);
    expect(report.reason).toBe("disk full");
    expect(report.original_msg).toHaveLength(1024);
  });

  it("swallows a throwing console.error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console gone");
    });

    expect(() => reportWriteFailure(undefined, new Error("x"))).not.toThrow();
  });
});
