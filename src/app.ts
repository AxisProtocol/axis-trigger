import { Hono } from "hono";
import { cors } from "hono/cors";
import { swaggerUI } from "@hono/swagger-ui";
import { openapiSpec } from "./openapi";

export function createBaseApp(): Hono {
  const app = new Hono();

  app.use("/*", cors());

  app.get("/", (c) => c.json({ ok: true }));

  app.get("/docs", swaggerUI({ url: "/swagger.json" }));
  app.get("/swagger.json", (c) => c.json(openapiSpec));
  app.get("/openapi.json", (c) => c.json(openapiSpec));

  // TradingView endpoints that do not require DB
  app.get("/tv/config", (c) => {
    return c.json({
      supports_search: false,
      supports_group_request: false,
      supports_marks: false,
      supports_timescale_marks: false,
      supports_time: true,
      supported_resolutions: ["1", "5", "15", "60", "240", "D"],
    });
  });

  app.get("/tv/time", (c) => c.text(String(Math.floor(Date.now() / 1000))));

  app.get("/tv/symbols", (c) => {
    const symbol = (c.req.query("symbol") || "INDEX:FAMC").toUpperCase();
    return c.json({
      name: symbol,
      ticker: symbol,
      description: "FAMC Index (sum of free-float market caps)",
      type: "index",
      session: "24x7",
      timezone: "UTC",
      minmov: 1,
      pricescale: 100,
      has_intraday: true,
      supported_resolutions: ["1", "5", "15", "60", "240", "D"],
      has_daily: true,
      has_weekly_and_monthly: false,
    });
  });

  return app;
}


