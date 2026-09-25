import type { Context, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { resolveLevelPriority, resolveOutput, type ResolvedOutput } from "./config.ts";
import { DEFAULT_LEVEL } from "./levels.ts";
import { createLoggerFromCore, type BaseFields } from "./logger.ts";
import { sanitize } from "./sanitize.ts";
import { reportWriteFailure } from "./sink.ts";
import type { LoggerConfig, RequestMetadata } from "./types.ts";

const DEFAULT_TRACE_HEADER = "X-Request-Id";

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
  readonly traceHeader: string;
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

function buildBase(resolved: ResolvedConfig, c: Context, output: ResolvedOutput): BaseFields {
  const base: BaseFields = {};
  const traceId = c.req.header(resolved.traceHeader) ?? c.req.header("cf-ray");
  if (traceId) {
    base.trace_id = traceId;
  }

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

  base.req = sanitize(req, output.sanitize);
  return base;
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

export function logger(config: LoggerConfig = {}): MiddlewareHandler {
  const { traceHeader = DEFAULT_TRACE_HEADER, autoLogging = "silent", header = false } = config;

  const minPriority = resolveLevelPriority(config.level, DEFAULT_LEVEL);
  const output = resolveOutput(config);
  const resolved: ResolvedConfig = {
    traceHeader,
    includeCfProperties: [...(config.includeCfProperties ?? [])],
    headers: typeof header === "boolean" ? header : header.map((name) => name.toLowerCase()),
    query: config.query ?? false,
  };
  const buildRequestBase = (c: Context, requestOutput: ResolvedOutput): BaseFields =>
    buildBase(resolved, c, requestOutput);

  const createRequestLogger = (c: Context) =>
    createLoggerFromCore({
      minPriority,
      output,
      buildBase: buildRequestBase,
      baseVersion: routeVersion,
      baseInput: c,
      base: undefined,
      baseStamp: 0,
    });

  if (autoLogging === "silent" && !output.flush) {
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

    if (output.flush) {
      scheduleFlush(c, output.flush);
    }

    if (thrownError) {
      throw thrownError;
    }
  };
}
