import type { SyslogLevel } from "./types.ts";

export const SYSLOG_LEVELS: readonly SyslogLevel[] = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
];

const LEVEL_PRIORITY: Readonly<Record<SyslogLevel, number>> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
};

export type ConsoleMethod = "debug" | "info" | "warn" | "error";

/**
 * Console method per level priority. Workers Logs records the console method
 * as the event level, so this keeps the dashboard's level filter accurate.
 */
export const CONSOLE_METHOD_BY_PRIORITY: readonly ConsoleMethod[] = [
  "debug",
  "info",
  "info",
  "warn",
  "error",
  "error",
  "error",
  "error",
];

export const DEFAULT_LEVEL: SyslogLevel = "info";
export const INFO_LEVEL_PRIORITY = LEVEL_PRIORITY.info;
export const WARNING_LEVEL_PRIORITY = LEVEL_PRIORITY.warning;
export const ERROR_LEVEL_PRIORITY = LEVEL_PRIORITY.error;

export function isSyslogLevel(value: unknown): value is SyslogLevel {
  return typeof value === "string" && Object.hasOwn(LEVEL_PRIORITY, value);
}

export function getLevelPriority(level: SyslogLevel): number {
  return LEVEL_PRIORITY[level];
}

export function shouldLogPriority(levelPriority: number, minLevelPriority: number): boolean {
  return levelPriority >= minLevelPriority;
}

export function shouldLog(level: SyslogLevel, minLevel: SyslogLevel): boolean {
  return shouldLogPriority(getLevelPriority(level), getLevelPriority(minLevel));
}

export function isErrorLevel(level: SyslogLevel): boolean {
  return getLevelPriority(level) >= ERROR_LEVEL_PRIORITY;
}
