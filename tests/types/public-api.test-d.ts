import { Hono, type MiddlewareHandler } from "hono";
import { describe, expectTypeOf, it } from "vitest";
import { getLogger } from "../../src/context";
import {
  createLogger,
  logger,
  type CfPropertyKey,
  type LogEntry,
  type Logger,
  type LoggerConfig,
  type SerializedError,
  type SyslogLevel,
} from "../../src/index";

describe("public types", () => {
  it("types c.var.logger through ContextVariableMap", () => {
    const app = new Hono();
    app.use("*", logger());
    app.get("/", (c) => {
      expectTypeOf(c.var.logger).toEqualTypeOf<Logger>();
      expectTypeOf(c.get("logger")).toEqualTypeOf<Logger>();
      return c.text("ok");
    });
  });

  it("types the level resolver and skip against the app Env", () => {
    type AppEnv = { Bindings: { LOG_LEVEL: string } };

    expectTypeOf(logger<AppEnv>).returns.toEqualTypeOf<MiddlewareHandler<AppEnv>>();
    logger<AppEnv>({
      level: (c) => {
        expectTypeOf(c.env.LOG_LEVEL).toEqualTypeOf<string>();
        return c.env.LOG_LEVEL;
      },
      skip: (c) => c.env.LOG_LEVEL === "silent",
    });

    // @ts-expect-error unknown binding
    logger<AppEnv>({ level: (c) => c.env.MISSING });
  });

  it("accepts known and custom cf keys", () => {
    expectTypeOf<"colo">().toExtend<CfPropertyKey>();
    expectTypeOf<"customKey">().toExtend<CfPropertyKey>();
    expectTypeOf<LoggerConfig["includeCfProperties"]>().toEqualTypeOf<
      readonly CfPropertyKey[] | undefined
    >();
  });

  it("rejects unknown levels and formats", () => {
    // @ts-expect-error not a syslog level
    logger({ level: "verbose" });
    // @ts-expect-error not an output format
    logger({ format: "text" });
    expectTypeOf<SyslogLevel>().toEqualTypeOf<
      "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"
    >();
  });

  it("types logger methods, error inputs and sinks", () => {
    const log = createLogger();

    expectTypeOf(log.info).parameter(0).toEqualTypeOf<string>();
    log.error("any thrown value", "not an Error");
    log.error("with data", new Error("x"), { id: 1 }, { placement: "flat" });
    // @ts-expect-error placement is nested or flat
    log.info("bad", {}, { placement: "trace" });
    expectTypeOf(log.child({ component: "db" })).toEqualTypeOf<Logger>();
    expectTypeOf(log.traceId).toEqualTypeOf<string | undefined>();
    expectTypeOf(getLogger()).toEqualTypeOf<Logger>();

    createLogger({
      sink: (entry, info) => {
        expectTypeOf(entry).toEqualTypeOf<LogEntry>();
        expectTypeOf(entry.err).toEqualTypeOf<SerializedError | undefined>();
        expectTypeOf(info.priority).toEqualTypeOf<number>();
      },
    });
  });
});
