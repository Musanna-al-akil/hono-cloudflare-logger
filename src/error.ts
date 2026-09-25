import type { SerializedError } from "./types.ts";

const MAX_CAUSE_DEPTH = 3;
const MAX_AGGREGATE_ERRORS = 10;

type SanitizeFn = (value: unknown) => unknown;

function isError(value: unknown): value is Error {
  return (
    value instanceof Error ||
    (typeof value === "object" &&
      value !== null &&
      Object.prototype.toString.call(value) === "[object Error]")
  );
}

function clip(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…[truncated]` : value;
}

function describeNonError(value: unknown, sanitize: SanitizeFn, maxLength: number): string {
  if (typeof value === "string") {
    return clip(value, maxLength);
  }

  if (typeof value === "object" && value !== null) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") {
      return clip(message, maxLength);
    }

    try {
      return clip(JSON.stringify(sanitize(value)) ?? String(value), maxLength);
    } catch {
      return "[Unserializable]";
    }
  }

  return clip(String(value), maxLength);
}

/**
 * Converts anything that can be thrown into a JSON-safe error shape.
 * Includes `name`, `message`, `stack`, a string/number `code`, a numeric
 * `status` (e.g. Hono's HTTPException), a bounded `cause` chain and the first
 * `AggregateError` members. Other own properties are left out on purpose:
 * they often carry request payloads or credentials.
 */
export function serializeError(
  value: unknown,
  sanitize: SanitizeFn,
  maxLength: number,
  depth = 0,
): SerializedError {
  if (!isError(value)) {
    return { name: "NonError", message: describeNonError(value, sanitize, maxLength) };
  }

  const serialized: SerializedError = {
    name: typeof value.name === "string" ? value.name : "Error",
    message: clip(String(value.message), maxLength),
  };

  if (typeof value.stack === "string") {
    serialized.stack = clip(value.stack, maxLength);
  }

  const { code, status } = value as { code?: unknown; status?: unknown };
  if (typeof code === "string" || typeof code === "number") {
    serialized.code = code;
  }
  if (typeof status === "number") {
    serialized.status = status;
  }

  if (value.cause !== undefined) {
    serialized.cause =
      depth >= MAX_CAUSE_DEPTH
        ? "[Cause depth exceeded]"
        : isError(value.cause)
          ? serializeError(value.cause, sanitize, maxLength, depth + 1)
          : sanitize(value.cause);
  }

  const errors = (value as { errors?: unknown }).errors;
  if (Array.isArray(errors) && depth < MAX_CAUSE_DEPTH) {
    serialized.errors = errors
      .slice(0, MAX_AGGREGATE_ERRORS)
      .map((item) => serializeError(item, sanitize, maxLength, depth + 1));
  }

  return serialized;
}
