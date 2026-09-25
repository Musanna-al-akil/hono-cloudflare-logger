let cachedMs = Number.NaN;
let cachedIso = "";

/**
 * ISO-8601 timestamp, cached per millisecond. In Workers `Date.now()` only
 * advances after I/O, so every entry written between two I/O operations
 * reuses the same string instead of formatting a new one.
 */
export function isoTimestamp(): string {
  const now = Date.now();
  if (now !== cachedMs) {
    cachedMs = now;
    cachedIso = new Date(now).toISOString();
  }
  return cachedIso;
}
