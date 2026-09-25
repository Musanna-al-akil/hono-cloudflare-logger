import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { createLogger, logger } from "hono-cloudflare-logger";
import { getLogger } from "hono-cloudflare-logger/context";

type Bindings = { LOG_LEVEL?: string };

const app = new Hono<{ Bindings: Bindings }>();

// Makes the current request available to getLogger() in helpers.
app.use("*", contextStorage());
// Reuses or generates X-Request-Id; the logger picks it up as trace_id.
app.use("*", requestId());
app.use(
  "*",
  logger<{ Bindings: Bindings }>({
    level: (c) => c.env.LOG_LEVEL,
    autoLogging: "error",
    // Debug/info entries are only written when the request fails.
    bufferUntilError: true,
    includeCfProperties: ["colo", "country", "asn"],
    header: ["user-agent", "authorization"],
    redactKeys: ["password", "token"],
  }),
);

/** Deep helper without access to `c`: finds the request logger through context storage. */
async function verifyPassword(email: string, password: string): Promise<boolean> {
  const log = getLogger().child({ component: "auth" });
  log.debug("verifying credentials", { email, password });
  await new Promise((resolve) => setTimeout(resolve, 5));
  return password === "secret";
}

app.post("/login", async (c) => {
  const log = c.var.logger;
  log.setContext({ feature: "auth-login" });

  const body = await c.req
    .json<{ email?: string; password?: string }>()
    .catch(() => ({}) as { email?: string; password?: string });
  log.info("login request received", { hasEmail: Boolean(body.email) });

  if (!body.email || !body.password) {
    throw new HTTPException(400, { message: "missing email or password" });
  }

  if (!(await verifyPassword(body.email, body.password))) {
    log.warning("invalid credentials", { email: body.email });
    return c.json({ error: "Invalid credentials" }, 401);
  }

  if (body.email === "fail@example.com") {
    // The buffered debug/info entries above are written together with the error.
    throw new Error("Simulated session store failure");
  }

  log.info("login successful", { email: body.email });
  return c.json({ ok: true });
});

// The logger middleware already records thrown errors; Hono's default handler
// would print them a second time.
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  return c.json({ error: "Internal Server Error" }, 500);
});

app.get("/health", (c) => {
  c.var.logger.debug("health check");
  return c.text("ok");
});

export default {
  fetch: app.fetch,
  // Outside of Hono: a standalone logger with its own trace id and bindings.
  async scheduled(controller: { cron: string; scheduledTime: number }, env: Bindings) {
    const log = createLogger({
      level: env.LOG_LEVEL === "debug" ? "debug" : "info",
      traceId: `cron-${controller.scheduledTime}`,
      bindings: { handler: "scheduled", cron: controller.cron },
    });
    log.info("cleanup started");
    log.info("cleanup finished", { removed: 0 });
  },
};
