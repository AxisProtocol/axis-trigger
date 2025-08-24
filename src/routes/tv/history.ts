import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { SUPPORTED_RESOLUTIONS } from "../../utils/indexSeries";

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

  // Map resolution to seconds for bucketing
  const RES_TO_SEC: Record<"1" | "5" | "15" | "60" | "240" | "D", number> = {
    "1": 60,
    "5": 300,
    "15": 900,
    "60": 3600,
    "240": 14400,
    "D": 86400,
  };
  const intervalSec = RES_TO_SEC[resolution as keyof typeof RES_TO_SEC];
  const famcSymbol = "FAMC_INDEX"; // stored by backfill script

  const rows = await (prisma as any).price.findMany({
    where: { symbol: famcSymbol, priceTimestamp: { gte: new Date(from * 1000), lte: new Date(to * 1000) } },
    orderBy: { priceTimestamp: "asc" }
  }) as Array<{ priceTimestamp: Date; price: string }>;

  const toUnixSeconds = (d: Date): number => Math.floor(d.getTime() / 1000);
  const toBucketStart = (unixSec: number, sec: number): number => Math.floor(unixSec / sec) * sec;

  let cursorIdx = 0;
  const t: number[] = [];
  const values: number[] = [];
  let lastPrice: number | undefined = undefined;
  for (let bucketStart = toBucketStart(from, intervalSec); bucketStart <= to; bucketStart += intervalSec) {
    const bucketEnd = bucketStart + intervalSec - 1;
    while (cursorIdx < rows.length) {
      const row = rows[cursorIdx];
      const tsSec = toUnixSeconds(row.priceTimestamp);
      if (tsSec > bucketEnd) break;
      lastPrice = Number(row.price);
      cursorIdx += 1;
    }
    if (lastPrice !== undefined) {
      t.push(bucketStart);
      values.push(lastPrice);
    }
  }

  if (t.length === 0) return c.json({ s: "no_data" }) as any;
  const o = values.slice();
  const h = values.slice();
  const l = values.slice();
  const v = new Array(values.length).fill(0);
  return c.json({ s: "ok", t, c: values, o, h, l, v, symbol }) as any;
});


