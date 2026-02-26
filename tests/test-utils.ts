import { expect } from "vitest";

export function parseLoggedEntry(raw: unknown): Record<string, unknown> {
  expect(typeof raw).toBe("string");

  const line = String(raw);
  expect(line.endsWith("\n")).toBe(true);

  return JSON.parse(line.trimEnd()) as Record<string, unknown>;
}

export function parseLoggedEntryFromCalls(calls: unknown[][], index = 0): Record<string, unknown> {
  const call = calls[index];
  expect(call).toBeDefined();
  return parseLoggedEntry(call?.[0]);
}
