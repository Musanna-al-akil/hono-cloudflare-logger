import { Hono } from "hono";
import { logger } from "hono-cloudflare-logger";

const app = new Hono();

app.use(
  "*",
  logger({
    autoLogging: "access",
    includeCfProperties: ["colo", "country"],
  }),
);

app.get("/", (c) => {
  c.var.logger.info("hello from minimal example");
  return c.json({ ok: true });
});

export default app;
