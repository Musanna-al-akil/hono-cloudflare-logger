import { vi, type MockInstance } from "vitest";

export type ConsoleMethodName = "log" | "info" | "warn" | "error" | "debug";

export type ConsoleSpies = Record<ConsoleMethodName, MockInstance>;

export interface LoggedCall {
  method: ConsoleMethodName;
  entry: Record<string, unknown>;
}

const METHODS: readonly ConsoleMethodName[] = ["log", "info", "warn", "error", "debug"];

/** Silences and records every console method. Restored by vitest's `restoreMocks`. */
export function spyOnConsole(): ConsoleSpies {
  const spies = {} as ConsoleSpies;
  for (const method of METHODS) {
    spies[method] = vi.spyOn(console, method).mockImplementation(() => {});
  }
  return spies;
}

/**
 * Normalizes one console argument to the JSON shape a log pipeline would see:
 * strings are parsed as JSON, objects are round-tripped through JSON.
 */
export function toEntry(raw: unknown): Record<string, unknown> {
  const json = typeof raw === "string" ? raw : JSON.stringify(raw);
  return JSON.parse(json) as Record<string, unknown>;
}

/** Every logged entry across all console methods, in call order. */
export function loggedCalls(spies: ConsoleSpies): LoggedCall[] {
  const calls: Array<LoggedCall & { order: number }> = [];
  for (const method of METHODS) {
    const mock = spies[method].mock;
    mock.calls.forEach((args, index) => {
      calls.push({
        method,
        entry: toEntry(args[0]),
        order: mock.invocationCallOrder[index] ?? 0,
      });
    });
  }

  return calls
    .sort((left, right) => left.order - right.order)
    .map(({ method, entry }) => ({ method, entry }));
}

export function loggedEntries(spies: ConsoleSpies): Record<string, unknown>[] {
  return loggedCalls(spies).map((call) => call.entry);
}

/** The single logged entry; fails when there is not exactly one. */
export function onlyEntry(spies: ConsoleSpies): Record<string, unknown> {
  const entries = loggedEntries(spies);
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one log entry, got ${entries.length}`);
  }
  return entries[0] as Record<string, unknown>;
}
