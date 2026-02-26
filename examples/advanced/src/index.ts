import { Hono } from "hono";
import { logger, type LoggerVariables } from "hono-cloudflare-logger";

const app = new Hono<{ Variables: LoggerVariables }>();

app.use(
  "*",
  logger({
    level: "debug",
    autoLogging: "error",
    traceHeader: "x-request-id",
    includeCfProperties: ["colo", "country", "asn"],
    redactKeys: ["authorization", "password", "token"],
  }),
);

app.post("/login", async (c) => {
  const log = c.get("logger");
  const userId = c.req.header("x-user-id") ?? "anonymous";

  log.setContext({ userId, feature: "auth-login" });
  log.info("login request received", {
    provider: "password",
    authorization: c.req.header("authorization"),
  });

  const body = await c.req
    .json<{ email?: string; password?: string }>()
    .catch(() => ({}) as { email?: string; password?: string });

  if (!body.email || !body.password) {
    log.warning("validation failed", { reason: "missing-fields" });
    return c.json({ error: "Invalid input" }, 400);
  }

  if (body.email === "fail@example.com") {
    throw new Error("Simulated unhandled authentication failure");
  }

  log.info("login successful", { email: body.email });
  return c.json({ ok: true });
});

app.get("/health", (c) => {
  c.get("logger").debug("health check");
  return c.text("ok");
});

export default app;
