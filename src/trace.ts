import type { Context } from "hono";

/** Printable ASCII without spaces, 1-255 chars: safe to log and to echo in a header. */
const VALID_ID = /^[\x21-\x7e]{1,255}$/;
const TRACEPARENT = /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})(-.*)?$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_PARENT_ID = "0".repeat(16);

export interface TraceIdOptions {
  /** Header checked first (after `hono/request-id`), or `undefined` to skip. */
  readonly header: string | undefined;
  readonly traceparent: boolean;
  readonly generate: (() => string) | undefined;
}

export function isValidTraceId(value: unknown): value is string {
  return typeof value === "string" && VALID_ID.test(value);
}

/**
 * Extracts the trace-id from a W3C `traceparent` header
 * (`version-traceid-parentid-flags`). Returns `undefined` for invalid values,
 * including the all-zero ids the spec forbids.
 */
export function parseTraceparent(header: string | null | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const match = TRACEPARENT.exec(header.trim());
  if (!match) {
    return undefined;
  }

  const [, version, traceId, parentId, , suffix] = match;
  if (version === "ff" || (version === "00" && suffix !== undefined)) {
    return undefined;
  }
  if (traceId === ZERO_TRACE_ID || parentId === ZERO_PARENT_ID) {
    return undefined;
  }

  return traceId;
}

export function defaultTraceIdGenerator(): string {
  return crypto.randomUUID();
}

/**
 * Resolves the request's correlation id, in order: the id set by Hono's
 * `requestId()` middleware, the configured header, the W3C `traceparent`
 * trace-id, Cloudflare's `cf-ray`, then a generated id.
 */
/** Inbound id, in precedence order: `requestId()` middleware, header, traceparent, cf-ray. */
function inboundTraceId(c: Context, options: TraceIdOptions): string | undefined {
  const fromRequestIdMiddleware = (c.get as (key: string) => unknown)("requestId");
  if (isValidTraceId(fromRequestIdMiddleware)) {
    return fromRequestIdMiddleware;
  }

  if (options.header) {
    const fromHeader = c.req.header(options.header);
    if (isValidTraceId(fromHeader)) {
      return fromHeader;
    }
  }

  if (options.traceparent) {
    const fromTraceparent = parseTraceparent(c.req.header("traceparent"));
    if (fromTraceparent) {
      return fromTraceparent;
    }
  }

  const ray = c.req.header("cf-ray");
  return isValidTraceId(ray) ? ray : undefined;
}

export function resolveTraceId(c: Context, options: TraceIdOptions): string | undefined {
  try {
    const inbound = inboundTraceId(c, options);
    if (inbound !== undefined) {
      return inbound;
    }
  } catch {
    // Unreadable request: fall through to a generated id.
  }

  if (options.generate) {
    try {
      const generated = options.generate();
      if (isValidTraceId(generated)) {
        return generated;
      }
    } catch {
      // A failing generator must not break logging.
    }
  }

  return undefined;
}
