import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { computeIndexSeries, SUPPORTED_RESOLUTIONS } from "../../utils/indexSeries";

const QuerySchema = z.object({
  symbol: z.string().optional(),
  resolution: z.enum(["1","5","15","60","240","D"]).optional().default("60"),
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
});

const OkSchema = z.object({
  s: z.literal("ok"),
  t: z.array(z.number().int()),
  c: z.array(z.number()),
  o: z.array(z.number()),
  h: z.array(z.number()),
  l: z.array(z.number()),
  v: z.array(z.number()),
  symbol: z.string().optional(),
});

const NoDataSchema = z.object({ s: z.literal("no_data") });
const ErrorSchema = z.object({ s: z.literal("error"), errmsg: z.string() });

const route = createRoute({
  method: "get",
  path: "/history",
  request: { query: QuerySchema },
  responses: {
    200: { description: "Series data or no_data", content: { "application/json": { schema: z.union([OkSchema, NoDataSchema]) } } },
    400: { description: "Invalid request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

export const tvHistory = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const symbol = (c.req.query("symbol") || "INDEX:FAMC").toUpperCase();
  const resolution = (c.req.query("resolution") as any) || "60";
  const from = Number(c.req.query("from"));
  const to = Number(c.req.query("to"));
  if (!from || !to) return c.json({ s: "error", errmsg: "from/to required (unix seconds)" }, 400) as any;
  if (!SUPPORTED_RESOLUTIONS.includes(resolution)) return c.json({ s: "error", errmsg: "invalid resolution" }, 400) as any;
  const prisma = (c.get("prisma") as unknown) as PrismaLike;
  const { t, c: values } = await computeIndexSeries(from, to, resolution, prisma);
  if (t.length === 0) return c.json({ s: "no_data" }) as any;
  const o = values.slice();
  const h = values.slice();
  const l = values.slice();
  const v = new Array(values.length).fill(0);
  return c.json({ s: "ok", t, c: values, o, h, l, v, symbol }) as any;
});


