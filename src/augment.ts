import type { Logger } from "./logger.ts";

// Types `c.var.logger` / `c.get("logger")` without app generics, the same way
// Hono's own middleware does. It lives in its own side-effect module because
// JSR's fast check rejects ambient `declare module` blocks in the public
// entry; `src/index.ts` imports it so both npm and JSR consumers see it.
declare module "hono" {
  interface ContextVariableMap {
    /** Request-scoped logger set by the `logger()` middleware. */
    logger: Logger;
  }
}
