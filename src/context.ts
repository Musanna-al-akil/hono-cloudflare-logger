/**
 * `getLogger()` for code that has no access to the Hono context.
 *
 * Import from `hono-cloudflare-logger/context`. Requires Hono's
 * `contextStorage()` middleware, which uses `AsyncLocalStorage`: enable the
 * `nodejs_compat` (or `nodejs_als`) compatibility flag on Workers. Kept out of
 * the main entry so the core never imports `node:async_hooks`.
 *
 * @module
 */
import { getContext } from "hono/context-storage";
import { Logger } from "./logger.ts";

let fallbackLogger: Logger | undefined;

/**
 * Returns the current request's logger, or a shared default logger when
 * called outside a request (or before the `logger()` middleware ran).
 */
export function getLogger(): Logger {
  try {
    const requestLogger = (getContext().get as (key: string) => unknown)("logger");
    if (requestLogger instanceof Logger) {
      return requestLogger;
    }
  } catch {
    // No request context: fall through to the default logger.
  }

  fallbackLogger ??= new Logger();
  return fallbackLogger;
}
