import type { Context, MiddlewareHandler } from "hono";
import { DEFAULT_LEVEL, getLevelPriority } from "./levels.ts";
import { createLoggerFromCore, type BaseFields } from "./logger.ts";
import { createKeyMatcher, redactDeep, type KeyMatcher } from "./redact.ts";
import type { LoggerConfig, RequestMetadata } from "./types.ts";

const DEFAULT_TRACE_HEADER = "X-Request-Id";
const DEFAULT_AUTO_LOGGING = "silent";
const DEFAULT_INCLUDE_HEADERS = false;

/** Configuration normalized once per `logger()` call instead of once per request. */
interface ResolvedConfig {
  readonly traceHeader: string;
  readonly includeCfProperties: readonly string[];
  /** `true` captures every header, a list captures lowercased allowlisted names. */
  readonly headers: boolean | readonly string[];
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
): Record<string, string> | undefined {
  if (headers === false) {
    return undefined;
  }

  const picked: Record<string, string> = {};
  let hasHeaders = false;

  if (headers === true) {
    rawHeaders.forEach((value, key) => {
      picked[key] = value;
      hasHeaders = true;
    });
  } else {
    for (const key of headers) {
      const value = rawHeaders.get(key);
      if (value !== null) {
        picked[key] = value;
        hasHeaders = true;
      }
    }
  }

  return hasHeaders ? picked : undefined;
}

function buildBase(
  resolved: ResolvedConfig,
  c: Context,
  matcher: KeyMatcher | undefined,
): BaseFields {
  const base: BaseFields = {};
  const traceId = c.req.header(resolved.traceHeader) ?? c.req.header("cf-ray");
  if (traceId) {
    base.trace_id = traceId;
  }

  const req: RequestMetadata = {
    method: c.req.method,
    url: c.req.path,
  };
  const headers = pickRequestHeaders(c.req.raw.headers, resolved.headers);
  if (headers) {
    req.headers = headers;
  }

  const cf = pickCfProperties((c.req.raw as { cf?: unknown }).cf, resolved.includeCfProperties);
  if (cf) {
    req.cf = cf;
  }

  base.req = redactDeep(req, matcher);
  return base;
}

export function logger(config: LoggerConfig = {}): MiddlewareHandler {
  const {
    level = DEFAULT_LEVEL,
    traceHeader = DEFAULT_TRACE_HEADER,
    autoLogging = DEFAULT_AUTO_LOGGING,
    includeCfProperties = [],
    redactKeys = [],
    header = DEFAULT_INCLUDE_HEADERS,
  } = config;

  const minPriority = getLevelPriority(level);
  const matcher = createKeyMatcher(redactKeys);
  const resolved: ResolvedConfig = {
    traceHeader,
    includeCfProperties: [...includeCfProperties],
    headers: typeof header === "boolean" ? header : header.map((name) => name.toLowerCase()),
  };
  const buildRequestBase = (c: Context, keyMatcher: KeyMatcher | undefined): BaseFields =>
    buildBase(resolved, c, keyMatcher);

  if (autoLogging === "silent") {
    // Nothing happens after the handler, so skip the timer and the extra async frame.
    return (c, next) => {
      c.set(
        "logger",
        createLoggerFromCore({
          minPriority,
          matcher,
          buildBase: buildRequestBase,
          baseInput: c,
          base: undefined,
        }) as never,
      );
      return next();
    };
  }

  return async (c, next) => {
    const startTime = Date.now();
    let thrownError: unknown;

    const requestLogger = createLoggerFromCore({
      minPriority,
      matcher,
      buildBase: buildRequestBase,
      baseInput: c,
      base: undefined,
    });

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
        {
          status,
          duration_ms: durationMs,
        },
        { dataPlacement: "flat" },
      );
    } else {
      const runtimeError = thrownError ?? (c as { error?: unknown }).error;
      if (runtimeError) {
        const err = runtimeError instanceof Error ? runtimeError : undefined;
        requestLogger.error(
          "Unhandled error",
          err,
          { duration_ms: durationMs },
          {
            dataPlacement: "flat",
          },
        );
      } else if (status >= 500) {
        requestLogger.error(
          "Request failed",
          undefined,
          {
            status,
            duration_ms: durationMs,
          },
          { dataPlacement: "flat" },
        );
      }
    }

    if (thrownError) {
      throw thrownError;
    }
  };
}
