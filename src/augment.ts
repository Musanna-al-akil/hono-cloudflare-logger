import type { Logger } from "./logger.ts";

// Types `c.var.logger` / `c.get("logger")` without app generics, the same way
// Hono's own middleware does. npm only: JSR rejects module augmentation at
// publish time ("modifying global types is not allowed"), so only the npm
// entry (`index.ts`) imports this file, and jsr.json excludes it.
// `scripts/check-jsr.mjs` fails if the JSR entry's graph ever reaches it.
declare module "hono" {
  interface ContextVariableMap {
    /** Request-scoped logger set by the `logger()` middleware. */
    logger: Logger;
  }
}
