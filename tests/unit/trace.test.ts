import { describe, expect, it } from "vitest";
import { isValidTraceId, parseTraceparent } from "../../src/trace";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

describe("parseTraceparent", () => {
  it("extracts the trace-id from a version 00 header", () => {
    expect(parseTraceparent(`00-${TRACE_ID}-00f067aa0ba902b7-01`)).toBe(TRACE_ID);
    expect(parseTraceparent(`  00-${TRACE_ID}-00f067aa0ba902b7-00  `)).toBe(TRACE_ID);
  });

  it("accepts future versions with extra fields", () => {
    expect(parseTraceparent(`cc-${TRACE_ID}-00f067aa0ba902b7-01-what-the-future-holds`)).toBe(
      TRACE_ID,
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["garbage", "not-a-traceparent"],
    ["uppercase hex", `00-${TRACE_ID.toUpperCase()}-00f067aa0ba902b7-01`],
    ["short trace-id", "00-4bf92f3577b34da6-00f067aa0ba902b7-01"],
    ["all-zero trace-id", `00-${"0".repeat(32)}-00f067aa0ba902b7-01`],
    ["all-zero parent-id", `00-${TRACE_ID}-${"0".repeat(16)}-01`],
    ["forbidden version ff", `ff-${TRACE_ID}-00f067aa0ba902b7-01`],
    ["version 00 with extra fields", `00-${TRACE_ID}-00f067aa0ba902b7-01-extra`],
  ])("rejects %s", (_label, header) => {
    expect(parseTraceparent(header)).toBeUndefined();
  });
});

describe("isValidTraceId", () => {
  it("accepts printable ids up to 255 chars", () => {
    expect(isValidTraceId("req-123")).toBe(true);
    expect(isValidTraceId("8f1c2a3b4c5d6e7f-SIN")).toBe(true);
    expect(isValidTraceId("a".repeat(255))).toBe(true);
  });

  it("rejects empty, oversized, whitespace and control characters", () => {
    expect(isValidTraceId("")).toBe(false);
    expect(isValidTraceId("a".repeat(256))).toBe(false);
    expect(isValidTraceId("has space")).toBe(false);
    expect(isValidTraceId("line\nbreak")).toBe(false);
    expect(isValidTraceId(42)).toBe(false);
  });
});
