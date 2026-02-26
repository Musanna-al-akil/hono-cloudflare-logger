const REDACTED_VALUE = "[REDACTED]";

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

function redactNode(
  value: unknown,
  redactKeys: ReadonlySet<string>,
  seen: WeakMap<object, unknown>,
): unknown {
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
      const redactedItem = redactNode(item, redactKeys, seen);
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
  const sourceKeys = Object.keys(source);

  for (const key of sourceKeys) {
    const rawValue = source[key];
    if (redactKeys.has(key.toLowerCase())) {
      if (!clone) {
        clone = { ...source };
        seen.set(source, clone);
      }

      clone[key] = REDACTED_VALUE;
      continue;
    }

    const redactedValue = redactNode(rawValue, redactKeys, seen);
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

export function redactDeep<T>(value: T, redactKeys: ReadonlySet<string>): T {
  if (redactKeys.size === 0) {
    return value;
  }

  return redactNode(value, redactKeys, new WeakMap()) as T;
}
