import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { loadAppConfig } from "../../config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv, loadAssetsFromBundledConfig } from "../../providers/envAssets";
import { fetchCoinGeckoRangeUSD } from "../../providers/coingecko/coingeckoRange";
import { loadAssetFreeFloats } from "../../utils/indexSeries";
import type { PrismaLike } from "../../db/types";

const ResponseSchema = z.object({
  ok: z.literal(true),
  famcSum: z.number(),
  assets: z.number().int(),
  runAt: z.string(),
});

const ErrorSchema = z.object({ message: z.string() });

const route = createRoute({
  method: "post",
  path: "/update",
  request: {
    headers: z.object({ "x-update-key": z.string().optional() }).openapi({ title: "UpdateHeaders" }),
  },
  responses: {
    200: { description: "Update executed", content: { "application/json": { schema: ResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
  },
});

export const update = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const headerKey = c.req.header("x-update-key") || "";
  const env = ((c as any).env as Record<string, string | undefined>) || {};
  const expected = env.UPDATE_ACCESS_KEY || process.env.UPDATE_ACCESS_KEY || "";
  if (!expected || headerKey !== expected) {
    return c.json({ message: "unauthorized" }, 401) as any;
  }

  const cfg = loadAppConfig();
  const assets = cfg.assetConfigFilePath ? loadAssetsFromBundledConfig() : loadAssetsFromEnv();

  const prisma = (c.get("prisma") as unknown) as PrismaLike as any;

  const nowSec = Math.floor(Date.now() / 1000);
  const defaultLookbackDays = Number(process.env.CRON_BACKFILL_DAYS || 7);
  const toUnix = nowSec;

  // Find the last stored FAMC index point; include a small overlap window to derive normalization
  const lastIndex = await prisma.price.findFirst?.({
    where: { symbol: "FAMC_INDEX" },
    orderBy: { priceTimestamp: "desc" },
    select: { priceTimestamp: true, price: true }
  });
  const overlapSec = 2 * 86400; // 2 days overlap to ensure we can compute k
  const fromUnix = lastIndex
    ? Math.floor(lastIndex.priceTimestamp.getTime() / 1000) - overlapSec
    : (nowSec - defaultLookbackDays * 86400);

  const { freeFloatBySymbol } = await loadAssetFreeFloats();
  const pricePointsBySymbol = new Map<string, { t: number; p: number; }[]>();
  for (const asset of assets) {
    if (!asset.coingeckoId) continue;
    const pts = await fetchCoinGeckoRangeUSD(asset.coingeckoId, fromUnix, toUnix);
    pricePointsBySymbol.set(asset.symbol, pts.map(p => ({ t: Math.floor(new Date(p.timestampIso).getTime() / 1000), p: p.price })));
  }

  // Build union timeline
  const allTimestamps = Array.from(new Set(
    Array.from(pricePointsBySymbol.values()).flat().map(p => p.t)
  )).sort((a, b) => a - b);

  const lastPrice = new Map<string, number>();
  const sumByTs = new Map<number, number>();
  for (const ts of allTimestamps) {
    for (const [symbol, series] of pricePointsBySymbol) {
      const atOrBefore = series.filter(p => p.t <= ts).pop();
      if (atOrBefore) lastPrice.set(symbol, atOrBefore.p);
    }
    if (assets.every(a => lastPrice.has(a.symbol))) {
      let sum = 0;
      for (const a of assets) {
        const ff = freeFloatBySymbol.get(a.symbol) || 0;
        sum += ff * (lastPrice.get(a.symbol) as number);
      }
      sumByTs.set(ts, sum);
    }
  }

  if (sumByTs.size === 0) {
    return c.json({ ok: true, message: "no points" }) as any;
  }

  // Derive normalization factor k from any overlapping timestamp with existing index
  let k = 1;
  if (lastIndex) {
    const tLast = Math.floor(lastIndex.priceTimestamp.getTime() / 1000);
    // choose the nearest sum at or before last index timestamp
    const candidateTs = Array.from(sumByTs.keys()).filter(t => t <= tLast).sort((a, b) => b - a)[0];
    if (candidateTs !== undefined) {
      const s = sumByTs.get(candidateTs) as number;
      const v = Number(lastIndex.price);
      if (s > 0) k = v / s;
    } else {
      // fallback to normalize first point in window to 100 if no overlap
      const firstTs = Array.from(sumByTs.keys()).sort((a, b) => a - b)[0];
      const s0 = sumByTs.get(firstTs) as number;
      if (s0 > 0) k = 100 / s0;
    }
  } else {
    const firstTs = Array.from(sumByTs.keys()).sort((a, b) => a - b)[0];
    const s0 = sumByTs.get(firstTs) as number;
    if (s0 > 0) k = 100 / s0;
  }

  const rows = Array.from(sumByTs.entries())
    .filter(([ts]) => !lastIndex || ts > Math.floor(lastIndex.priceTimestamp.getTime() / 1000))
    .map(([ts, s]) => ({
      symbol: "FAMC_INDEX",
      source: "coingecko" as const,
      price: (k * s).toString(),
      priceTimestamp: new Date(ts * 1000).toISOString()
    }));

  if (rows.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await prisma.price.createMany?.({ data: chunk, skipDuplicates: true });
    }
  }

  const runAt = new Date().toISOString();
  return c.json({ ok: true, inserted: rows.length, runAt }) as any;
});


