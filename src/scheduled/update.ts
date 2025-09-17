import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { loadAppConfig } from "../config";
import { loadAssetsFromEnv, loadAssetsFromBundledConfig } from "../providers/envAssets";
import { fetchCoinGeckoRangeUSD } from "../providers/coingecko/coingeckoRange";
import { loadAssetFreeFloats } from "../utils/indexSeries";
import { mapWithConcurrency } from "../utils/concurrency";
import { createPrisma } from "../db/prismaD1";
import type { PrismaLike } from "../db/types";

const ResponseSchema = z.object({
  ok: z.literal(true),
  famcIndexInserted: z.number().int(),
  assetPricesInserted: z.number().int(),
  runAt: z.string(),
});

const ErrorSchema = z.object({ message: z.string() });

const UpdateBodySchema = z
  .object({
    // YYYY-MM-DD in UTC
    startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    days: z.number().int().positive().max(90).optional(),
  })
  .openapi({ title: "UpdateBody" });

const AcceptedSchema = z.object({ ok: z.literal(true), accepted: z.literal(true), runAt: z.string() });

const route = createRoute({
  method: "post",
  path: "/update",
  request: {
    headers: z.object({ "x-update-key": z.string().optional() }).openapi({ title: "UpdateHeaders" }),
    body: {
      content: { "application/json": { schema: UpdateBodySchema } },
    },
  },
  responses: {
    200: { description: "Update executed", content: { "application/json": { schema: ResponseSchema } } },
    202: { description: "Update accepted (running in background)", content: { "application/json": { schema: AcceptedSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
  },
});

export async function performUpdate(
  prisma: PrismaLike,
  env: Record<string, string | undefined>,
  opts?: { startDay?: string; days?: number }
) {
  const cfg = loadAppConfig();
  const assets = cfg.assetConfigFilePath ? loadAssetsFromBundledConfig() : loadAssetsFromEnv();
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
  let fromUnix: number;
  if (opts?.startDay && opts?.days) {
    // Interpret startDay as UTC 00:00:00
    const start = new Date(`${opts.startDay}T00:00:00.000Z`).getTime() / 1000;
    const requestedFrom = Math.floor(start);
    const requestedTo = Math.min(toUnix, requestedFrom + opts.days * 86400);
    // Include overlap for normalization
    fromUnix = Math.max(0, requestedFrom - overlapSec);
    // Limit toUnix implicitly by using timestamp filters later when inserting rows (we map by timestamps)
  } else if (opts?.days) {
    fromUnix = nowSec - (opts.days * 86400) - overlapSec;
  } else {
    fromUnix = lastIndex
      ? Math.floor(lastIndex.priceTimestamp.getTime() / 1000) - overlapSec
      : (nowSec - defaultLookbackDays * 86400);
  }

  const { freeFloatBySymbol } = await loadAssetFreeFloats();
  const pricePointsBySymbol = new Map<string, { t: number; p: number; }[]>();

  // Fetch CoinGecko data in parallel with limited concurrency
  const cgConcurrency = Number(env.CG_CONCURRENCY || process.env.CG_CONCURRENCY || 4);
  type AssetFetchResult = { symbol: string; processedPts: { t: number; p: number; }[]; rows: { symbol: string; source: string; price: string; priceTimestamp: string; }[] } | null;
  const fetchResults = await mapWithConcurrency(assets, cgConcurrency, async (asset): Promise<AssetFetchResult> => {
    if (!asset.coingeckoId) return null;
    const pts = await fetchCoinGeckoRangeUSD(asset.coingeckoId, fromUnix, toUnix);
    const processedPts = pts.map(p => ({ t: Math.floor(new Date(p.timestampIso).getTime() / 1000), p: p.price }));
    const rows = pts.map(pt => ({ symbol: asset.symbol, source: "coingecko", price: pt.price.toString(), priceTimestamp: pt.timestampIso }));
    return { symbol: asset.symbol, processedPts, rows };
  });

  // Store individual asset prices first
  const assetPriceRows: Array<{ symbol: string; source: string; price: string; priceTimestamp: string; }> = [];
  for (const res of fetchResults) {
    if (!res) continue;
    pricePointsBySymbol.set(res.symbol, res.processedPts);
    assetPriceRows.push(...res.rows);
  }

  // Build union timeline
  // If opts.startDay/days provided, clamp timeline to requested range (without overlap) for insert & calc
  const clampFrom = opts?.startDay && opts?.days
    ? Math.floor(new Date(`${opts.startDay}T00:00:00.000Z`).getTime() / 1000)
    : undefined;
  const clampTo = opts?.startDay && opts?.days
    ? Math.min(toUnix, (clampFrom as number) + opts.days * 86400)
    : undefined;

  const allTimestamps = Array.from(new Set(
    Array.from(pricePointsBySymbol.values()).flat().map(p => p.t)
  ))
    .filter(t => clampFrom === undefined || t >= clampFrom)
    .filter(t => clampTo === undefined || t <= clampTo)
    .sort((a, b) => a - b);

  // Build weighted sum timeline using pointer walk (avoid O(n^2) scans)
  const lastPrice = new Map<string, number>();
  const sumByTs = new Map<number, number>();
  const pointerBySymbol = new Map<string, number>();
  for (const [symbol, series] of pricePointsBySymbol) {
    series.sort((a, b) => a.t - b.t);
    pointerBySymbol.set(symbol, -1);
  }
  for (const ts of allTimestamps) {
    for (const [symbol, series] of pricePointsBySymbol) {
      let idx = pointerBySymbol.get(symbol) as number;
      while (idx + 1 < series.length && series[idx + 1].t <= ts) idx++;
      pointerBySymbol.set(symbol, idx);
      if (idx >= 0) lastPrice.set(symbol, series[idx].p);
    }
    if (lastPrice.size === assets.length) {
      let sum = 0;
      for (const a of assets) {
        const ff = freeFloatBySymbol.get(a.symbol) || 0;
        sum += ff * (lastPrice.get(a.symbol) as number);
      }
      sumByTs.set(ts, sum);
    }
  }

  if (sumByTs.size === 0) {
    return { ok: true as const, famcIndexInserted: 0, assetPricesInserted: 0, runAt: new Date().toISOString() };
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

  // Helper to batch insert rows using multi-row VALUES to reduce CPU overhead
  async function insertRows(rowsToInsert: Array<{ symbol: string; source: string; price: string; priceTimestamp: string; }>) {
    if (rowsToInsert.length === 0) return;
    const rowsPerChunk = 100; // 100 rows * 4 params = 400 params per statement
    for (let i = 0; i < rowsToInsert.length; i += rowsPerChunk) {
      const chunk = rowsToInsert.slice(i, i + rowsPerChunk);
      const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
      const sql = `INSERT OR IGNORE INTO Price (symbol, source, price, priceTimestamp) VALUES ${placeholders}`;
      const params: any[] = [];
      for (const r of chunk) params.push(r.symbol, r.source, r.price, r.priceTimestamp);
      await (prisma as any).$queryRawUnsafe(sql, ...params);
    }
  }

  // Insert individual asset prices first
  await insertRows(assetPriceRows);

  // Then insert FAMC_INDEX rows
  await insertRows(rows as any);

  const runAt = new Date().toISOString();
  return { ok: true as const, famcIndexInserted: rows.length, assetPricesInserted: assetPriceRows.length, runAt };
}

// api route for manual update
export const update = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const headerKey = c.req.header("x-update-key") || "";
  const env = ((c as any).env as Record<string, string | undefined>) || {};
  const expected = env.UPDATE_ACCESS_KEY || process.env.UPDATE_ACCESS_KEY || "";
  if (!expected || headerKey !== expected) {
    return c.json({ message: "unauthorized" }, 401) as any;
  }
  // Run update in background to avoid request CPU time limits
  const db = (env as any).DB;
  if (c.executionCtx && db) {
    c.executionCtx.waitUntil((async () => {
      const prismaBg = createPrisma({ DB: db });
      try {
        await performUpdate(prismaBg as any, env);
      } catch (e) {
        console.error("Background update failed", e);
      } finally {
        try { await (prismaBg as any).$disconnect?.(); } catch {}
      }
    })());
    return c.json({ ok: true as const, accepted: true as const, runAt: new Date().toISOString() }, 202) as any;
  }
  // Fallback: run inline if executionCtx or DB binding is not available
  const prisma = (c.get("prisma") as unknown) as PrismaLike as any;
  const result = await performUpdate(prisma, env);
  return c.json(result) as any;
});