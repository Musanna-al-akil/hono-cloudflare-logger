import { getLevelPriority, isSyslogLevel } from "./levels.ts";
import {
  createKeyMatcher,
  DEFAULT_CENSOR,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_STRING_LENGTH,
  type SanitizeOptions,
} from "./sanitize.ts";
import { createWriter, type EntryWriter } from "./sink.ts";
import type { LogFormat, LogSink, LogSinkObject, SyslogLevel } from "./types.ts";

/** Output-related options shared by the middleware and standalone loggers. */
export interface OutputOptions {
  format?: LogFormat;
  sink?: LogSink | LogSinkObject;
  timestamp?: boolean;
  redactKeys?: readonly string[];
  censor?: string;
  maxStringLength?: number;
}

/** Output configuration resolved once and shared by every logger that uses it. */
export interface ResolvedOutput {
  readonly write: EntryWriter;
  readonly flush: (() => Promise<void>) | undefined;
  readonly timestamp: boolean;
  readonly sanitize: SanitizeOptions;
}

const LOG_FORMATS: ReadonlySet<string> = new Set<LogFormat>(["object", "json", "pretty"]);
const NO_KEYS: readonly string[] = [];

// Standalone loggers are often created with only `redactKeys`; share their output config.
const defaultOutputs = new WeakMap<readonly string[], ResolvedOutput>();

export function resolveLevelPriority(
  level: SyslogLevel | undefined,
  fallback: SyslogLevel,
): number {
  if (level === undefined) {
    return getLevelPriority(fallback);
  }

  if (!isSyslogLevel(level)) {
    throw new TypeError(`hono-cloudflare-logger: unknown log level "${String(level)}"`);
  }

  return getLevelPriority(level);
}

function createOutput(options: OutputOptions): ResolvedOutput {
  const format = options.format ?? "object";
  if (!LOG_FORMATS.has(format)) {
    throw new TypeError(`hono-cloudflare-logger: unknown format "${String(format)}"`);
  }

  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;
  if (!(maxStringLength > 0)) {
    throw new TypeError("hono-cloudflare-logger: maxStringLength must be a positive number");
  }

  const sink = options.sink;
  const flush =
    sink && typeof sink === "object" && typeof sink.flush === "function"
      ? sink.flush.bind(sink)
      : undefined;

  return {
    write: createWriter(format, sink),
    flush,
    timestamp: options.timestamp ?? true,
    sanitize: {
      matcher: createKeyMatcher(options.redactKeys ?? NO_KEYS),
      censor: options.censor ?? DEFAULT_CENSOR,
      maxStringLength,
      maxDepth: DEFAULT_MAX_DEPTH,
    },
  };
}

export function resolveOutput(options: OutputOptions): ResolvedOutput {
  const usesDefaults =
    options.format === undefined &&
    options.sink === undefined &&
    options.timestamp === undefined &&
    options.censor === undefined &&
    options.maxStringLength === undefined;

  if (!usesDefaults) {
    return createOutput(options);
  }

  const keys = options.redactKeys ?? NO_KEYS;
  let output = defaultOutputs.get(keys);
  if (!output) {
    output = createOutput(options);
    defaultOutputs.set(keys, output);
  }
  return output;
}
