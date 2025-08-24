import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const QuerySchema = z.object({
  symbol: z.string().optional().openapi({ description: "Symbol, default INDEX:FAMC" }),
});

const ResponseSchema = z.object({
  name: z.string(),
  ticker: z.string(),
  description: z.string(),
  type: z.string(),
  session: z.string(),
  timezone: z.string(),
  minmov: z.number().int(),
  pricescale: z.number().int(),
  has_intraday: z.boolean(),
  supported_resolutions: z.array(z.string()),
  has_daily: z.boolean(),
  has_weekly_and_monthly: z.boolean(),
});

const route = createRoute({
  method: "get",
  path: "/symbols",
  request: { query: QuerySchema },
  responses: {
    200: { description: "Symbol info", content: { "application/json": { schema: ResponseSchema } } },
  },
});

export const tvSymbols = new OpenAPIHono().openapi(route, async (c) => {
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


