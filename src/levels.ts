import type { SyslogLevel } from "./types";

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

export const DEFAULT_LEVEL: SyslogLevel = "info";
export const ERROR_LEVEL_PRIORITY = LEVEL_PRIORITY.error;

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
