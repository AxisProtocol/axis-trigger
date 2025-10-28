import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { withKvCache } from "../../utils/kvCache";
import { SUPPORTED_RESOLUTIONS, computeIndexSeries, loadAssetFreeFloats } from "../../utils/indexSeries";

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

  // If finer than daily is requested, compute from constituents to provide granular data
  if (symbol === "INDEX:FAMC" && resolution !== "D") {
    try {
      // Align start to the latest of the earliest timestamps across all constituents
      const { symbols } = await loadAssetFreeFloats();
      const earliestPerSymbol = await Promise.all(symbols.map(async (s) => {
        const row = await (prisma as any).price.findFirst({
          where: { symbol: s },
          orderBy: { priceTimestamp: 'asc' },
          select: { priceTimestamp: true }
        });
        return row?.priceTimestamp as Date | undefined;
      }));
      const earliestSecs = earliestPerSymbol.filter(Boolean).map(d => Math.floor((d as Date).getTime() / 1000));
      const latestOfEarliest = earliestSecs.length > 0 ? Math.max(...earliestSecs) : from;
      const adjustedFrom = Math.max(from, latestOfEarliest);

      console.log("[tv/history] computing on-the-fly for fine resolution", { requestedResolution: resolution, adjustedFrom, to });
      let { t: ct, c: cc } = await computeIndexSeries(adjustedFrom, to, resolution as any, prisma);
      if (ct.length === 0) {
        // Retry with 5-minute resolution as a minimum granularity fallback
        if (resolution !== "5") {
          console.warn("[tv/history] no buckets at requested resolution; retrying 5-min", { requestedResolution: resolution, adjustedFrom, to });
          const retry = await computeIndexSeries(adjustedFrom, to, "5", prisma);
          ct = retry.t;
          cc = retry.c;
        }
      }
      if (ct.length === 0) {
        console.warn("[tv/history] fine-resolution compute yielded no buckets; falling back to precomputed", { resolution, adjustedFrom, to });
      } else {
        const o2 = cc.slice();
        const h2 = cc.slice();
        const l2 = cc.slice();
        const v2 = new Array(cc.length).fill(0);
        return c.json({ s: "ok", t: ct, c: cc, o: o2, h: h2, l: l2, v: v2, symbol }) as any;
      }
    } catch (e) {
      console.warn("[tv/history] fine-resolution compute failed", e);
      // fall through to precomputed path which may return sparse data
    }
  }

  const cacheKey = `tv:history:${famcSymbol}:${resolution}:${from}:${to}`;
  const rows = await withKvCache<Array<{ priceTimestamp: Date; price: string }>>(c, cacheKey, 30, async () => {
    const data = await (prisma as any).price.findMany({
      where: { symbol: famcSymbol, priceTimestamp: { gte: new Date(from * 1000), lte: new Date(to * 1000) } },
      orderBy: { priceTimestamp: "asc" }
    }) as Array<{ priceTimestamp: Date; price: string }>;
    return data;
  });

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

  // Fallback: if no precomputed index data, compute on the fly from constituents
  if (t.length === 0 && symbol === "INDEX:FAMC") {
    try {
      const { t: ct, c: cc } = await computeIndexSeries(from, to, resolution as any, prisma);
      if (ct.length === 0) return c.json({ s: "no_data" }) as any;
      const o2 = cc.slice();
      const h2 = cc.slice();
      const l2 = cc.slice();
      const v2 = new Array(cc.length).fill(0);
      return c.json({ s: "ok", t: ct, c: cc, o: o2, h: h2, l: l2, v: v2, symbol }) as any;
    } catch (e) {
      console.warn("[tv/history] fallback compute failed", e);
      return c.json({ s: "no_data" }) as any;
    }
  }

  if (t.length === 0) {
    console.warn("[tv/history] no data from precomputed path", { symbol, resolution, from, to });
    return c.json({ s: "no_data" }) as any;
  }
  const o = values.slice();
  const h = values.slice();
  const l = values.slice();
  const v = new Array(values.length).fill(0);
  return c.json({ s: "ok", t, c: values, o, h, l, v, symbol }) as any;
});


