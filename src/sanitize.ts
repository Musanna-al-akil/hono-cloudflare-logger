const MATCHER_CACHE_LIMIT = 512;

export const DEFAULT_CENSOR = "[REDACTED]";
export const DEFAULT_MAX_STRING_LENGTH = 8192;
export const DEFAULT_MAX_DEPTH = 10;

const CIRCULAR = "[Circular]";
const UNSERIALIZABLE = "[Unserializable]";

/**
 * Case-insensitive key matcher. Object keys are low-cardinality, so results
 * are memoized to avoid a `toLowerCase()` allocation for every visited key.
 */
export class KeyMatcher {
  private readonly normalized: ReadonlySet<string>;
  private readonly cache = new Map<string, boolean>();

  constructor(keys: readonly string[]) {
    this.normalized = new Set(keys.map((key) => key.toLowerCase()));
  }

  matches(key: string): boolean {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = this.normalized.has(key.toLowerCase());
    if (this.cache.size >= MATCHER_CACHE_LIMIT) {
      this.cache.clear();
    }
    this.cache.set(key, result);
    return result;
  }
}

// Callers usually pass the same constant array, so matchers are reused per array.
const matchersByKeys = new WeakMap<readonly string[], KeyMatcher>();

export function createKeyMatcher(keys: readonly string[]): KeyMatcher | undefined {
  if (keys.length === 0) {
    return undefined;
  }

  let matcher = matchersByKeys.get(keys);
  if (!matcher) {
    matcher = new KeyMatcher(keys);
    matchersByKeys.set(keys, matcher);
  }
  return matcher;
}

export interface SanitizeOptions {
  readonly matcher: KeyMatcher | undefined;
  readonly censor: string;
  readonly maxStringLength: number;
  readonly maxDepth: number;
}

function truncate(value: string, maxLength: number): string {
  return `${value.slice(0, maxLength)}…[truncated ${value.length - maxLength} chars]`;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeArray(
  source: readonly unknown[],
  options: SanitizeOptions,
  depth: number,
  ancestors: object[],
): unknown[] {
  let clone: unknown[] | undefined;

  const maxStringLength = options.maxStringLength;
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const sanitized = isPassThrough(item, maxStringLength)
      ? item
      : sanitizeValue(item, options, depth, ancestors);
    if (!clone) {
      if (sanitized === item) {
        continue;
      }
      clone = source.slice();
    }
    clone[index] = sanitized;
  }

  return clone ?? (source as unknown[]);
}

/** Values that never need sanitizing, checked inline to skip a function call per key. */
function isPassThrough(value: unknown, maxStringLength: number): boolean {
  const type = typeof value;
  return (
    type === "number" ||
    type === "boolean" ||
    type === "undefined" ||
    (type === "string" && (value as string).length <= maxStringLength)
  );
}

/**
 * Walks own enumerable keys. Plain objects are copied only when something
 * changes; other objects are always converted to plain objects, matching what
 * `JSON.stringify` would emit for them.
 */
function sanitizeRecord(
  source: Record<string, unknown>,
  options: SanitizeOptions,
  depth: number,
  ancestors: object[],
  alwaysCopy: boolean,
): Record<string, unknown> {
  const matcher = options.matcher;
  const maxStringLength = options.maxStringLength;
  const keys = Object.keys(source);
  let clone: Record<string, unknown> | undefined;

  if (alwaysCopy) {
    clone = {};
  }

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    const raw = source[key];
    let sanitized: unknown;
    if (matcher !== undefined && matcher.matches(key)) {
      sanitized = options.censor;
    } else if (isPassThrough(raw, maxStringLength)) {
      sanitized = raw;
    } else {
      sanitized = sanitizeValue(raw, options, depth, ancestors);
    }

    if (!clone) {
      if (sanitized === raw) {
        continue;
      }
      // First change: copy the unchanged keys before it, keeping key order.
      clone = {};
      for (let previous = 0; previous < index; previous += 1) {
        const previousKey = keys[previous] as string;
        clone[previousKey] = source[previousKey];
      }
    }

    if (sanitized !== undefined) {
      clone[key] = sanitized;
    }
  }

  return clone ?? source;
}

function sanitizeObject(
  value: object,
  options: SanitizeOptions,
  depth: number,
  ancestors: object[],
): unknown {
  if (ancestors.includes(value)) {
    return CIRCULAR;
  }

  if (depth >= options.maxDepth) {
    return Array.isArray(value) ? "[Array]" : "[Object]";
  }

  ancestors.push(value);
  try {
    const nextDepth = depth + 1;

    if (Array.isArray(value)) {
      return sanitizeArray(value, options, nextDepth, ancestors);
    }

    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      return sanitizeValue(toJSON.call(value), options, depth, ancestors);
    }

    if (value instanceof Map) {
      const record: Record<string, unknown> = {};
      for (const [key, item] of value) {
        record[String(key)] = item;
      }
      return sanitizeRecord(record, options, nextDepth, ancestors, false);
    }

    if (value instanceof Set) {
      return sanitizeArray([...value], options, nextDepth, ancestors);
    }

    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      return `[${value.constructor.name}(${value.byteLength})]`;
    }

    if (typeof Headers !== "undefined" && value instanceof Headers) {
      const record: Record<string, unknown> = {};
      value.forEach((item, key) => {
        record[key] = item;
      });
      return sanitizeRecord(record, options, nextDepth, ancestors, false);
    }

    return sanitizeRecord(
      value as Record<string, unknown>,
      options,
      nextDepth,
      ancestors,
      !isPlainObject(value),
    );
  } catch {
    return UNSERIALIZABLE;
  } finally {
    ancestors.pop();
  }
}

function sanitizeValue(
  value: unknown,
  options: SanitizeOptions,
  depth: number,
  ancestors: object[],
): unknown {
  switch (typeof value) {
    case "string":
      return value.length > options.maxStringLength
        ? truncate(value, options.maxStringLength)
        : value;
    case "object":
      return value === null ? null : sanitizeObject(value, options, depth, ancestors);
    case "bigint":
      return value.toString();
    case "symbol":
      return value.toString();
    case "function":
      return undefined;
    default:
      return value;
  }
}

/**
 * Makes a value safe to hand to the console or `JSON.stringify`: redacts
 * matching keys, replaces cycles, stringifies BigInt, caps depth and string
 * length, and converts Map/Set/binary/class instances to plain JSON shapes.
 * Unchanged plain objects and arrays are returned by reference.
 */
export function sanitize<T>(value: T, options: SanitizeOptions): T {
  return sanitizeValue(value, options, 0, []) as T;
}
