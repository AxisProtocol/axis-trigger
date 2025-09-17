import { loadAppConfig } from "../config";
import { loadAssetsFromEnv, loadAssetsFromBundledConfig } from "../providers/envAssets";
import { fetchCoinGeckoRangeUSD } from "../providers/coingecko/coingeckoRange";
import { loadAssetFreeFloats } from "../utils/indexSeries";
import type { PrismaLike } from "../db/types";

export async function performUpdate(
  prisma: PrismaLike,
  env: Record<string, string | undefined>,
  opts?: { endDay?: string; days?: number; famcOnly?: boolean }
) {
  const cfg = loadAppConfig();
  const assets = cfg.assetConfigFilePath ? loadAssetsFromBundledConfig() : loadAssetsFromEnv();
  const nowSec = Math.floor(Date.now() / 1000);
  const defaultLookbackDays = Number(process.env.CRON_BACKFILL_DAYS || 7);
  const toUnix = nowSec;

  const lastIndex = await prisma.price.findFirst?.({
    where: { symbol: "FAMC_INDEX" },
    orderBy: { priceTimestamp: "desc" },
    select: { priceTimestamp: true, price: true }
  });

  const overlapSec = 2 * 86400;
  let fromUnix: number;
  const daysRequested = Math.min(7, Math.max(1, opts?.days ?? 0));
  if (opts?.endDay && daysRequested > 0) {
    const todayUtc = new Date();
    const todayStr = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate())).toISOString().slice(0,10);
    const endPrefix = opts.endDay.slice(0, 10);
    const safeEnd = endPrefix > todayStr ? todayStr : endPrefix;
    const endStartSec = Math.floor(new Date(`${safeEnd}T00:00:00.000Z`).getTime() / 1000);
    const startSec = endStartSec - (daysRequested - 1) * 86400;
    fromUnix = Math.max(0, startSec - overlapSec);
    // clamp window later using clampFrom/clampTo
  } else if (daysRequested > 0) {
    fromUnix = nowSec - (daysRequested * 86400) - overlapSec;
  } else {
    fromUnix = lastIndex
      ? Math.floor(lastIndex.priceTimestamp.getTime() / 1000) - overlapSec
      : (nowSec - defaultLookbackDays * 86400);
  }

  const { freeFloatBySymbol } = await loadAssetFreeFloats();
  // Aggregation containers
  const sumByDayTs = new Map<number, number>();
  const countByDayTs = new Map<number, number>();

  let clampFrom: number | undefined = undefined;
  let clampTo: number | undefined = undefined;
  let compFrom: number | undefined = undefined; // computation start with overlap
  if (opts?.endDay && daysRequested > 0) {
    const todayUtc = new Date();
    const todayStr = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate())).toISOString().slice(0,10);
    const endPrefix = opts.endDay.slice(0, 10);
    const safeEnd = endPrefix > todayStr ? todayStr : endPrefix;
    const endStartSec = Math.floor(new Date(`${safeEnd}T00:00:00.000Z`).getTime() / 1000);
    clampTo = Math.min(toUnix, endStartSec + 86400 - 1);
    clampFrom = endStartSec - (daysRequested - 1) * 86400;
    compFrom = Math.max(0, clampFrom - overlapSec);
  }

  console.log("update: window", {
    endDay: opts?.endDay || null,
    days: daysRequested || null,
    fromUnix,
    toUnix,
    clampFrom,
    clampTo,
  });

  const assetPriceRows: Array<{ symbol: string; source: string; price: string; priceTimestamp: string; }> = [];
  const assetsWithCg = assets.filter(a => !!a.coingeckoId);
  for (const asset of assetsWithCg) {
    const pts = await fetchCoinGeckoRangeUSD(asset.coingeckoId as string, fromUnix, toUnix);
    const ff = freeFloatBySymbol.get(asset.symbol) || 0;
    const perDayLast: Map<number, { ts: number; iso: string; price: number }> = new Map();
    for (const pt of pts) {
      const ts = Math.floor(new Date(pt.timestampIso).getTime() / 1000);
      if ((compFrom !== undefined && ts < compFrom) || (clampTo !== undefined && ts > clampTo)) continue;
      const dayTs = Math.floor(ts / 86400) * 86400;
      const existing = perDayLast.get(dayTs);
      if (!existing || ts >= existing.ts) {
        perDayLast.set(dayTs, { ts, iso: pt.timestampIso, price: pt.price });
      }
    }
    // After collecting per-day last prices, update inserts and daily sums once per asset per day
    for (const [dayTs, info] of perDayLast.entries()) {
      if (clampFrom === undefined || dayTs >= clampFrom) {
        assetPriceRows.push({ symbol: asset.symbol, source: "coingecko", price: info.price.toString(), priceTimestamp: info.iso });
      }
      sumByDayTs.set(dayTs, (sumByDayTs.get(dayTs) || 0) + ff * info.price);
      countByDayTs.set(dayTs, (countByDayTs.get(dayTs) || 0) + 1);
    }
    console.log("update: asset stats", {
      symbol: asset.symbol,
      ptsFetched: pts.length,
      daysCovered: perDayLast.size,
    });
  }

  if (sumByDayTs.size === 0) {
    return { ok: true as const, famcIndexInserted: 0, assetPricesInserted: 0, runAt: new Date().toISOString() };
  }

  let k = 1;
  const tLast = lastIndex ? Math.floor(lastIndex.priceTimestamp.getTime() / 1000) : undefined;
  const requiredPerDay = assetsWithCg.length;
  const completeDaysAll = Array.from(sumByDayTs.keys()).filter(ts => (countByDayTs.get(ts) || 0) === requiredPerDay).sort((a, b) => a - b);
  const completeDays = completeDaysAll.filter(ts => clampFrom === undefined || ts >= clampFrom);
  if (completeDays.length === 0) {
    return { ok: true as const, famcIndexInserted: 0, assetPricesInserted: assetPriceRows.length, runAt: new Date().toISOString() };
  }
  if (tLast !== undefined) {
    let kSet = false;
    if (clampFrom !== undefined) {
      try {
        const prevIndex = await (prisma as any).price.findFirst?.({
          where: { symbol: "FAMC_INDEX", priceTimestamp: { lte: new Date(clampFrom * 1000) } },
          orderBy: { priceTimestamp: "desc" },
          select: { priceTimestamp: true, price: true }
        });
        if (prevIndex) {
          const prevTs = Math.floor(prevIndex.priceTimestamp.getTime() / 1000);
          const candidateTs = completeDaysAll.filter(t => t <= prevTs).sort((a, b) => b - a)[0];
          if (candidateTs !== undefined) {
            const s = sumByDayTs.get(candidateTs) as number;
            const v = Number(prevIndex.price);
            if (s > 0) { k = v / s; kSet = true; }
          }
        }
      } catch {}
    }
    if (!kSet) {
      const firstTs = completeDays[0];
      const s0 = firstTs !== undefined ? (sumByDayTs.get(firstTs) as number) : 0;
      if (s0 > 0) k = 100 / s0;
    }
  } else {
    const firstTs = completeDays[0];
    const s0 = firstTs !== undefined ? (sumByDayTs.get(firstTs) as number) : 0;
    if (s0 > 0) k = 100 / s0;
  }

  const rows = completeDays
    .filter(ts => (opts?.endDay ? true : (tLast === undefined || ts > tLast)))
    .map(ts => ({
      symbol: "FAMC_INDEX",
      source: "coingecko" as const,
      price: (k * (sumByDayTs.get(ts) as number)).toString(),
      priceTimestamp: new Date(ts * 1000).toISOString()
    }));

  async function insertRows(rowsToInsert: Array<{ symbol: string; source: string; price: string; priceTimestamp: string; }>) {
    if (rowsToInsert.length === 0) return;
    const maxParams = Number(env.D1_MAX_PARAMS || process.env.D1_MAX_PARAMS || 100);
    const rowsPerChunk = Math.max(1, Math.min(25, Math.floor(maxParams / 4)));
    for (let i = 0; i < rowsToInsert.length; i += rowsPerChunk) {
      const chunk = rowsToInsert.slice(i, i + rowsPerChunk);
      const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
      const sql = `INSERT OR IGNORE INTO Price (symbol, source, price, priceTimestamp) VALUES ${placeholders}`;
      const params: any[] = [];
      for (const r of chunk) params.push(r.symbol, r.source, r.price, r.priceTimestamp);
      await (prisma as any).$queryRawUnsafe(sql, ...params);
    }
  }

  console.log("update: aggregation", {
    assets: assetsWithCg.length,
    completeDays: completeDays.length,
    k,
  });

  const insertAssetPrices = !opts?.famcOnly && ((env.INSERT_ASSET_PRICES || process.env.INSERT_ASSET_PRICES) === "true");
  if (insertAssetPrices) {
    await insertRows(assetPriceRows);
  } else {
    console.log("update: skipping asset price inserts", { count: assetPriceRows.length });
  }
  await insertRows(rows as any);

  console.log("update: inserted", {
    assetPricesInserted: assetPriceRows.length,
    famcIndexInserted: rows.length,
  });

  const runAt = new Date().toISOString();
  return { ok: true as const, famcIndexInserted: rows.length, assetPricesInserted: assetPriceRows.length, runAt };
}


