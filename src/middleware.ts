import type { MiddlewareHandler } from "hono";
import { DEFAULT_LEVEL } from "./levels";
import { Logger } from "./logger";
import type { LoggerConfig, RequestMetadata } from "./types";

const DEFAULT_TRACE_HEADER = "X-Request-Id";
const DEFAULT_AUTO_LOGGING = "silent";
const DEFAULT_INCLUDE_HEADERS = false;

type HeaderConfig = NonNullable<LoggerConfig["header"]>;

function pickCfProperties(
  rawCf: unknown,
  includeKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (!rawCf || typeof rawCf !== "object") {
    return undefined;
  }

  if (includeKeys.length === 0) {
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
  headerConfig: HeaderConfig,
): Record<string, string> | undefined {
  if (headerConfig === false) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  let hasHeaders = false;

  if (headerConfig === true) {
    rawHeaders.forEach((value, key) => {
      headers[key] = value;
      hasHeaders = true;
    });
  } else {
    for (const key of headerConfig) {
      const value = rawHeaders.get(key);
      if (value !== null) {
        headers[key.toLowerCase()] = value;
        hasHeaders = true;
      }
    }
  }

  return hasHeaders ? headers : undefined;
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

  return async (c, next) => {
    const startTime = Date.now();
    let thrownError: unknown;

    const traceId = c.req.header(traceHeader) ?? c.req.header("cf-ray");
    const reqMeta: RequestMetadata = {
      method: c.req.method,
      url: c.req.path,
    };
    const headers = pickRequestHeaders(c.req.raw.headers, header);
    if (headers) {
      reqMeta.headers = headers;
    }

    const cf = pickCfProperties((c.req.raw as { cf?: unknown }).cf, includeCfProperties);
    if (cf) {
      reqMeta.cf = cf;
    }

    const loggerOptions: ConstructorParameters<typeof Logger>[0] = {
      level,
      req: reqMeta,
      redactKeys,
    };
    if (traceId) {
      loggerOptions.traceId = traceId;
    }

    const requestLogger = new Logger(loggerOptions);

    c.set("logger", requestLogger as never);

    try {
      await next();
    } catch (error) {
      thrownError = error;
    }

    if (autoLogging !== "silent") {
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
    }

    if (thrownError) {
      throw thrownError;
    }
  };
}
