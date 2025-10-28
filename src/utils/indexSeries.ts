import type { PrismaLike } from "../db/types";
import { loadAppConfig } from "../config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv, loadAssetsFromBundledConfig } from "../providers/envAssets";
import { computeFreeFloat } from "./famc";

export type Resolution = "1" | "5" | "15" | "60" | "240" | "D";

export const SUPPORTED_RESOLUTIONS: Resolution[] = ["1", "5", "15", "60", "240", "D"];

const RES_TO_SEC: Record<Resolution, number> = {
  "1": 60,
  "5": 300,
  "15": 900,
  "60": 3600,
  "240": 14400,
  "D": 86400,
};

function toUnixSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function toBucketStart(unixSec: number, intervalSec: number): number {
  return Math.floor(unixSec / intervalSec) * intervalSec;
}

export async function loadAssetFreeFloats(): Promise<{ symbols: string[]; freeFloatBySymbol: Map<string, number>; }>
{
  const cfg = loadAppConfig();
  // Merge env and bundled; env overrides by symbol
  const envAssets = loadAssetsFromEnv();
  const bundledAssets = loadAssetsFromBundledConfig();
  const bySymbol = new Map<string, (typeof envAssets)[number]>();
  for (const a of bundledAssets) bySymbol.set(a.symbol, a);
  for (const a of envAssets) bySymbol.set(a.symbol, a);
  const assets = Array.from(bySymbol.values());
  const freeFloatBySymbol = new Map<string, number>();
  for (const a of assets) {
    const { freeFloat } = computeFreeFloat(a);
    freeFloatBySymbol.set(a.symbol, freeFloat);
  }
  const symbols = assets.map(a => a.symbol);
  return { symbols, freeFloatBySymbol };
}

export async function computeIndexSeries(
  fromSec: number,
  toSec: number,
  resolution: Resolution,
  prisma: PrismaLike,
): Promise<{ t: number[]; c: number[]; }>
{
  const { symbols, freeFloatBySymbol } = await loadAssetFreeFloats();
  const intervalSec = RES_TO_SEC[resolution];

  // Seed last price for each symbol with the most recent price at or before fromSec
  const seeds = await Promise.all(symbols.map(async (symbol) => {
    const row = await (prisma as any).price.findFirst({
      where: { symbol, priceTimestamp: { lte: new Date(fromSec * 1000) } },
      orderBy: { priceTimestamp: "desc" },
      select: { symbol: true, price: true }
    });
    return row as { symbol: string; price: string } | null;
  }));

  const prices = await prisma.price.findMany({
    where: {
      symbol: { in: symbols },
      priceTimestamp: { gte: new Date(fromSec * 1000), lte: new Date(toSec * 1000) }
    },
    orderBy: { priceTimestamp: "asc" }
  });

  const lastPriceBySymbol = new Map<string, number>();
  for (const seed of seeds) {
    if (seed) lastPriceBySymbol.set(seed.symbol, Number(seed.price));
  }
  let cursorIdx = 0;
  const t: number[] = [];
  const c: number[] = [];
  for (let bucketStart = toBucketStart(fromSec, intervalSec); bucketStart <= toSec; bucketStart += intervalSec) {
    const bucketEnd = bucketStart + intervalSec - 1;
    while (cursorIdx < prices.length) {
      const row = prices[cursorIdx];
      const tsSec = toUnixSeconds(row.priceTimestamp);
      if (tsSec > bucketEnd) break;
      lastPriceBySymbol.set(row.symbol, Number(row.price));
      cursorIdx += 1;
    }
    if (symbols.every(s => lastPriceBySymbol.has(s))) {
      let sum = 0;
      for (const s of symbols) {
        const ff = freeFloatBySymbol.get(s) || 0;
        const p = lastPriceBySymbol.get(s) as number;
        sum += ff * p;
      }
      t.push(bucketStart);
      c.push(sum);
    }
  }
  return { t, c };
}


