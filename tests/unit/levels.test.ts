import { describe, expect, it } from "vitest";
import { isErrorLevel, shouldLog } from "../../src/levels";

describe("levels", () => {
  it("filters logs by minimum level", () => {
    expect(shouldLog("debug", "info")).toBe(false);
    expect(shouldLog("info", "info")).toBe(true);
    expect(shouldLog("critical", "warning")).toBe(true);
    expect(shouldLog("notice", "error")).toBe(false);
  });

  it("detects error-level severities", () => {
    expect(isErrorLevel("warning")).toBe(false);
    expect(isErrorLevel("error")).toBe(true);
    expect(isErrorLevel("emergency")).toBe(true);
  });
});
