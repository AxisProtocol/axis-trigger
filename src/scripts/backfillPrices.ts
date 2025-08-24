import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../db/client";
import { loadAppConfig } from "../config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv, loadAssetsFromBundledConfig } from "../providers/envAssets";
import { fetchCoinGeckoRangeUSD } from "../providers/coingecko/coingeckoRange";
import { loadAssetFreeFloats } from "../utils/indexSeries";

function parseStartDateEnv(): Date {
  const raw = process.env.START_DATE ?? "2024-08-01";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid START_DATE: ${raw}`);
  }
  return d;
}

async function main(): Promise<void> {
  const startDate = parseStartDateEnv();
  const endDate = new Date();

  const cfg = loadAppConfig();
  // Use bundled config when a file is specified to support serverless/bundled runtime
  const assets = cfg.assetConfigFilePath ? loadAssetsFromBundledConfig() : loadAssetsFromEnv();

  const fromUnix = Math.floor(startDate.getTime() / 1000);
  const toUnix = Math.floor(endDate.getTime() / 1000);

  // Build a time-indexed map of weighted sums for the index series
  const { freeFloatBySymbol } = await loadAssetFreeFloats();
  const pointsByTs = new Map<string, number>();
  const pricePointsBySymbol = new Map<string, { t: string; p: number; }[]>();

  for (const asset of assets) {
    if (!asset.coingeckoId) {
      console.warn(`Skipping ${asset.symbol}: missing coingeckoId`);
      continue;
    }
    console.log(`Fetching ${asset.symbol} (${asset.coingeckoId}) from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    const pts = await fetchCoinGeckoRangeUSD(asset.coingeckoId, fromUnix, toUnix);
    pricePointsBySymbol.set(asset.symbol, pts.map(p => ({ t: p.timestampIso, p: p.price })));
  }

  // Merge by timestamp using last-known price per symbol
  const allTimestamps = Array.from(new Set(
    Array.from(pricePointsBySymbol.values()).flat().map(p => p.t)
  )).sort();

  const lastPrice = new Map<string, number>();
  for (const ts of allTimestamps) {
    for (const [symbol, series] of pricePointsBySymbol) {
      const atOrBefore = series.filter(p => p.t <= ts).pop();
      if (atOrBefore) lastPrice.set(symbol, atOrBefore.p);
    }
    // Only compute index when all symbols have a price
    if (assets.every(a => lastPrice.has(a.symbol))) {
      let sum = 0;
      for (const a of assets) {
        const ff = freeFloatBySymbol.get(a.symbol) || 0;
        sum += ff * (lastPrice.get(a.symbol) as number);
      }
      pointsByTs.set(ts, sum);
    }
  }

  const sorted = Array.from(pointsByTs.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const base = sorted.length > 0 ? sorted[0][1] : 0;
  const rows = sorted.map(([ts, val]) => ({
    symbol: "FAMC_INDEX",
    source: "coingecko" as const,
    price: (base > 0 ? (100 * (val / base)) : 0).toString(),
    priceTimestamp: ts
  }));

  // Insert in chunks to avoid exceeding parameter limits
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await prisma.price.createMany({ data: chunk, skipDuplicates: true });
    console.log(`Inserted ${Math.min(chunk.length, rows.length - i)} index rows (${i + chunk.length}/${rows.length})`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });


