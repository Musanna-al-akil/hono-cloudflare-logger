import type { Context, Env, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { resolveLevelPriority, resolveOutput, type ResolvedOutput } from "./config.ts";
import {
  DEFAULT_LEVEL,
  ERROR_LEVEL_PRIORITY,
  getLevelPriority,
  isSyslogLevel,
  WARNING_LEVEL_PRIORITY,
} from "./levels.ts";
import {
  createLoggerFromCore,
  discardBuffer,
  flushBuffer,
  type Logger,
  type LoggerCore,
  warningWithError,
} from "./logger.ts";
import { sanitize } from "./sanitize.ts";
import { reportWriteFailure } from "./sink.ts";
import { defaultTraceIdGenerator, resolveTraceId, type TraceIdOptions } from "./trace.ts";
import type { AutoLoggingMode, LevelResolver, LoggerConfig, RequestMetadata } from "./types.ts";

const DEFAULT_TRACE_HEADER = "x-request-id";

/** Credentials that never belong in logs, whatever the header options say. */
const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "cf-access-jwt-assertion",
  "cf-access-client-secret",
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

/**
 * Registered pattern of the matched route. `routePath()` reads match results
 * through a symbol owned by its copy of hono; when the app's request comes
 * from another copy (e.g. two installed versions), fall back to the
 * request's own getter.
 */
function resolveRoutePath(c: Context): string | undefined {
  try {
    return routePath(c);
  } catch {
    try {
      return (c.req as { routePath?: string }).routePath;
    } catch {
      return undefined;
    }
  }
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

  const route = resolveRoutePath(c);
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

const AUTO_LOGGING_MODES: ReadonlySet<string> = new Set<AutoLoggingMode>([
  "silent",
  "access",
  "error",
]);

function validateConfig(config: LoggerConfig): void {
  const { autoLogging, sampleRate, responseHeader } = config;
  if (autoLogging !== undefined && !AUTO_LOGGING_MODES.has(autoLogging)) {
    throw new TypeError(`hono-cloudflare-logger: unknown autoLogging "${String(autoLogging)}"`);
  }
  if (sampleRate !== undefined && !(sampleRate >= 0 && sampleRate <= 1)) {
    throw new TypeError("hono-cloudflare-logger: sampleRate must be between 0 and 1");
  }
  if (responseHeader !== undefined && responseHeader !== false) {
    try {
      // Throws for anything that isn't a valid header name, including "".
      new Headers().has(responseHeader);
    } catch {
      throw new TypeError(`hono-cloudflare-logger: invalid responseHeader "${responseHeader}"`);
    }
  }
}

/** Echoes the trace id unless the response already has the header. Best effort. */
function setResponseHeader(c: Context, name: string, traceId: string): void {
  try {
    if (!c.res.headers.has(name)) {
      c.header(name, traceId);
    }
  } catch {
    // Some responses can't be rebuilt with a new header (e.g. Response.error()).
  }
}

function shouldSkip(skip: ((c: Context) => boolean) | undefined, c: Context): boolean {
  if (skip === undefined) {
    return false;
  }
  try {
    return skip(c) === true;
  } catch {
    return false;
  }
}

/**
 * Duck-typed so it also recognizes an `HTTPException` from another installed
 * copy of hono.
 */
function isHttpException(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { getResponse?: unknown }).getResponse === "function"
  );
}

/** Writes the automatic entry for a finished request. */
function writeAutoEntry(
  requestLogger: Logger,
  mode: AutoLoggingMode,
  priority: number,
  status: number,
  durationMs: number,
  error: unknown,
  sampleRate: number,
): void {
  const data = { status, duration_ms: durationMs };

  if (priority >= ERROR_LEVEL_PRIORITY) {
    const msg = error === undefined ? "Request failed" : "Unhandled error";
    requestLogger.error(msg, error, data, { placement: "flat" });
    return;
  }

  if (mode !== "access") {
    return;
  }

  if (priority >= WARNING_LEVEL_PRIORITY) {
    if (error !== undefined && !isHttpException(error)) {
      // The app's onError turned a real error into a 4xx: keep the error.
      warningWithError(requestLogger, "Request completed", error, data, { placement: "flat" });
    } else {
      requestLogger.warning("Request completed", data, { placement: "flat" });
    }
  } else if (sampleRate >= 1 || Math.random() < sampleRate) {
    requestLogger.info("Request completed", data, { placement: "flat" });
  }
}

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
  validateConfig(config as LoggerConfig);
  const {
    autoLogging = "silent",
    header = false,
    responseHeader = false,
    sampleRate = 1,
    bufferUntilError = false,
  } = config;
  const skip = config.skip as ((c: Context) => boolean) | undefined;

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

  const createCore = (c: Context): LoggerCore<Context> => ({
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
    buffer: bufferUntilError ? [] : undefined,
    bufferDropped: 0,
  });

  if (autoLogging === "silent" && !output.flush && !responseHeader && !bufferUntilError) {
    // Nothing happens after the handler, so skip the timer and the extra async frame.
    return (c, next) => {
      c.set("logger", createLoggerFromCore(createCore(c)) as never);
      return next();
    };
  }

  return async (c, next) => {
    const startTime = Date.now();
    const core = createCore(c);
    const requestLogger = createLoggerFromCore(core);
    c.set("logger", requestLogger as never);

    let threw = false;
    let thrownError: unknown;
    try {
      await next();
    } catch (error) {
      threw = true;
      thrownError = error;
    }

    // Hono's onError handles thrown Errors and records them on c.error; only
    // non-Error throws reach this middleware, and the runtime turns them into a 500.
    const status = threw ? 500 : c.res.status;
    const error = threw ? thrownError : c.error;
    const priority =
      threw || status >= 500
        ? ERROR_LEVEL_PRIORITY
        : status >= 400
          ? WARNING_LEVEL_PRIORITY
          : getLevelPriority("info");

    // Settle the buffer first so the automatic entry is written, not buffered.
    if (core.buffer !== undefined) {
      if (priority >= ERROR_LEVEL_PRIORITY) {
        flushBuffer(core);
      } else {
        discardBuffer(core);
      }
    }

    if (autoLogging !== "silent" && !shouldSkip(skip, c)) {
      writeAutoEntry(
        requestLogger,
        autoLogging,
        priority,
        status,
        Date.now() - startTime,
        error,
        sampleRate,
      );
    }

    if (responseHeader && !threw) {
      const traceId = requestLogger.traceId;
      if (traceId !== undefined) {
        setResponseHeader(c, responseHeader, traceId);
      }
    }

    if (output.flush) {
      scheduleFlush(c, output.flush);
    }

    if (threw) {
      throw thrownError;
    }
  };
}
