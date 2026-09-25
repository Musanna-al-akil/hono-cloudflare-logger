const REDACTED_VALUE = "[REDACTED]";
const MATCHER_CACHE_LIMIT = 512;

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

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObjectLike(value) || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function redactNode(value: unknown, matcher: KeyMatcher, seen: WeakMap<object, unknown>): unknown {
  if (!isObjectLike(value)) {
    return value;
  }

  const cached = seen.get(value);
  if (cached !== undefined) {
    return cached;
  }

  if (Array.isArray(value)) {
    const source = value;
    seen.set(source, source);
    let clone: unknown[] | undefined;

    for (let index = 0; index < source.length; index += 1) {
      const item = source[index];
      const redactedItem = redactNode(item, matcher, seen);
      if (!clone) {
        if (redactedItem === item) {
          continue;
        }

        clone = source.slice();
        seen.set(source, clone);
      }

      clone[index] = redactedItem;
    }

    return clone ?? source;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const source = value;
  seen.set(source, source);
  let clone: Record<string, unknown> | undefined;

  for (const key in source) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    const rawValue = source[key];
    if (matcher.matches(key)) {
      if (!clone) {
        clone = { ...source };
        seen.set(source, clone);
      }

      clone[key] = REDACTED_VALUE;
      continue;
    }

    const redactedValue = redactNode(rawValue, matcher, seen);
    if (!clone) {
      if (redactedValue === rawValue) {
        continue;
      }

      clone = { ...source };
      seen.set(source, clone);
    }

    clone[key] = redactedValue;
  }

  return clone ?? source;
}

/** Redacts matching keys with copy-on-write: unchanged branches are returned as-is. */
export function redactDeep<T>(value: T, matcher: KeyMatcher | undefined): T {
  if (!matcher) {
    return value;
  }

  return redactNode(value, matcher, new WeakMap()) as T;
}
