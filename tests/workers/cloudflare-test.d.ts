// The subset of `cloudflare:test` these tests use. Declared locally so the
// package does not depend on @cloudflare/workers-types.
declare module "cloudflare:test" {
  import type { ExecutionContext } from "hono";

  export function createExecutionContext(): ExecutionContext;
  export function waitOnExecutionContext(ctx: ExecutionContext): Promise<void>;
}

// workerd accepts `cf` on RequestInit to populate `request.cf`.
interface RequestInit {
  cf?: Record<string, unknown>;
}
