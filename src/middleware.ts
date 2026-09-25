import type { Context, Env, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { resolveLevelPriority, resolveOutput, type ResolvedOutput } from "./config.ts";
import { DEFAULT_LEVEL, getLevelPriority, isSyslogLevel } from "./levels.ts";
import { createLoggerFromCore } from "./logger.ts";
import { sanitize } from "./sanitize.ts";
import { reportWriteFailure } from "./sink.ts";
import { defaultTraceIdGenerator, resolveTraceId, type TraceIdOptions } from "./trace.ts";
import type { LevelResolver, LoggerConfig, RequestMetadata } from "./types.ts";

const DEFAULT_TRACE_HEADER = "x-request-id";

/** Credentials that never belong in logs, whatever the header options say. */
const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "cf-access-jwt-assertion",
]);

/** Configuration normalized once per `logger()` call instead of once per request. */
interface ResolvedConfig {
  readonly includeCfProperties: readonly string[];
  /** `true` captures every header, a list captures lowercased allowlisted names. */
  readonly headers: boolean | readonly string[];
  readonly query: boolean;
}

function pickCfProperties(
  rawCf: unknown,
  includeKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (includeKeys.length === 0 || !rawCf || typeof rawCf !== "object") {
    return undefined;
  }

  const selected: Record<string, unknown> = {};
  let hasSelected = false;
  const cfRecord = rawCf as Record<string, unknown>;

  for (const key of includeKeys) {
    if (cfRecord[key] !== undefined) {
      selected[key] = cfRecord[key];
      hasSelected = true;
    }
  }

  return hasSelected ? selected : undefined;
}

function pickRequestHeaders(
  rawHeaders: Headers,
  headers: boolean | readonly string[],
  censor: string,
): Record<string, string> | undefined {
  if (headers === false) {
    return undefined;
  }

  const picked: Record<string, string> = {};
  let hasHeaders = false;

  if (headers === true) {
    rawHeaders.forEach((value, key) => {
      picked[key] = SENSITIVE_HEADERS.has(key) ? censor : value;
      hasHeaders = true;
    });
  } else {
    for (const key of headers) {
      const value = rawHeaders.get(key);
      if (value !== null) {
        picked[key] = SENSITIVE_HEADERS.has(key) ? censor : value;
        hasHeaders = true;
      }
    }
  }

  return hasHeaders ? picked : undefined;
}

function hasKeys(record: Record<string, unknown>): boolean {
  for (const _key in record) {
    return true;
  }
  return false;
}

function buildRequest(
  resolved: ResolvedConfig,
  c: Context,
  output: ResolvedOutput,
): RequestMetadata {
  const req: RequestMetadata = {
    method: c.req.method,
    path: c.req.path,
  };

  const route = routePath(c);
  if (route) {
    req.route = route;
  }

  if (resolved.query) {
    const query = c.req.query();
    if (hasKeys(query)) {
      req.query = query;
    }
  }

  const headers = pickRequestHeaders(c.req.raw.headers, resolved.headers, output.sanitize.censor);
  if (headers) {
    req.headers = headers;
  }

  const cf = pickCfProperties((c.req.raw as { cf?: unknown }).cf, resolved.includeCfProperties);
  if (cf) {
    req.cf = cf;
  }

  return sanitize(req, output.sanitize);
}

/** Hono advances `routeIndex` as it moves through middleware to the handler. */
function routeVersion(c: Context): number {
  return c.req.routeIndex;
}

/** Runs `flush` after the response via `waitUntil`, or detached outside Workers. */
function scheduleFlush(c: Context, flush: () => Promise<void>): void {
  const pending = Promise.resolve()
    .then(flush)
    .catch((error: unknown) => reportWriteFailure(undefined, error));

  try {
    c.executionCtx.waitUntil(pending);
  } catch {
    // No ExecutionContext (tests, non-Workers runtimes): the promise still runs.
  }
}

const DEFAULT_PRIORITY = getLevelPriority(DEFAULT_LEVEL);

/** Wraps a user level resolver: unknown values and exceptions fall back to the default. */
function createLevelResolver(resolver: LevelResolver): (c: Context) => number {
  return (c) => {
    try {
      const level = resolver(c);
      return isSyslogLevel(level) ? getLevelPriority(level) : DEFAULT_PRIORITY;
    } catch {
      return DEFAULT_PRIORITY;
    }
  };
}

/**
 * Hono middleware that puts a request-scoped {@link Logger} on `c.var.logger`
 * and optionally writes access or error entries when the response is ready.
 */
export function logger<E extends Env = any>(config: LoggerConfig<E> = {}): MiddlewareHandler<E> {
  const { autoLogging = "silent", header = false, responseHeader = false } = config;

  const level = config.level;
  const levelResolver =
    typeof level === "function" ? createLevelResolver(level as LevelResolver) : undefined;
  const minPriority =
    typeof level === "function" ? DEFAULT_PRIORITY : resolveLevelPriority(level, DEFAULT_LEVEL);
  const output = resolveOutput(config as LoggerConfig);
  const resolved: ResolvedConfig = {
    includeCfProperties: [...(config.includeCfProperties ?? [])],
    headers: typeof header === "boolean" ? header : header.map((name) => name.toLowerCase()),
    query: config.query ?? false,
  };
  const traceOptions: TraceIdOptions = {
    header: config.traceHeader === false ? undefined : (config.traceHeader ?? DEFAULT_TRACE_HEADER),
    traceparent: config.traceparent ?? true,
    generate:
      config.generateTraceId === false
        ? undefined
        : (config.generateTraceId ?? defaultTraceIdGenerator),
  };
  const resolveRequestTraceId = (c: Context): string | undefined => resolveTraceId(c, traceOptions);
  const buildRequestMetadata = (c: Context, requestOutput: ResolvedOutput): RequestMetadata =>
    buildRequest(resolved, c, requestOutput);

  const createRequestLogger = (c: Context) =>
    createLoggerFromCore({
      minPriority,
      levelResolver,
      output,
      input: c,
      resolveTraceId: resolveRequestTraceId,
      buildRequest: buildRequestMetadata,
      requestVersion: routeVersion,
      traceId: undefined,
      traceResolved: false,
      req: undefined,
      reqStamp: 0,
    });

  if (autoLogging === "silent" && !output.flush && !responseHeader) {
    // Nothing happens after the handler, so skip the timer and the extra async frame.
    return (c, next) => {
      c.set("logger", createRequestLogger(c) as never);
      return next();
    };
  }

  return async (c, next) => {
    const startTime = Date.now();
    let thrownError: unknown;

    const requestLogger = createRequestLogger(c);
    c.set("logger", requestLogger as never);

    try {
      await next();
    } catch (error) {
      thrownError = error;
    }

    const durationMs = Date.now() - startTime;
    const status = c.res.status;

    if (autoLogging === "access") {
      requestLogger.info(
        "Request completed",
        { status, duration_ms: durationMs },
        { placement: "flat" },
      );
    } else if (autoLogging === "error") {
      const runtimeError = thrownError ?? c.error;
      if (runtimeError) {
        requestLogger.error(
          "Unhandled error",
          runtimeError,
          { duration_ms: durationMs },
          { placement: "flat" },
        );
      } else if (status >= 500) {
        requestLogger.error(
          "Request failed",
          undefined,
          { status, duration_ms: durationMs },
          { placement: "flat" },
        );
      }
    }

    if (responseHeader) {
      const traceId = requestLogger.traceId;
      if (traceId !== undefined && !c.res.headers.has(responseHeader)) {
        c.header(responseHeader, traceId);
      }
    }

    if (output.flush) {
      scheduleFlush(c, output.flush);
    }

    if (thrownError) {
      throw thrownError;
    }
  };
}
