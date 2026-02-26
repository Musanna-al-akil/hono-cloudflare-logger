import { Hono } from "hono";
import { logger, type LoggerVariables } from "hono-cloudflare-logger";

const app = new Hono<{ Variables: LoggerVariables }>();

app.use(
  "*",
  logger({
    autoLogging: "access",
    includeCfProperties: ["colo", "country"],
    redactKeys: ["authorization"],
  }),
);

app.get("/", (c) => {
  c.get("logger").info("hello from minimal example");
  return c.json({ ok: true });
});

export default app;
