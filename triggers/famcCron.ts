import { schedules } from "@trigger.dev/sdk";
import { loadAppConfig } from "../src/config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv } from "../src/providers/envAssets";
import { fetchCoinGeckoPrices } from "../src/providers/prices/coingecko";
import { fetchCoinGeckoRangeUSD } from "../src/providers/prices/coingeckoRange";
import { prisma } from "../src/db/client";
import { computeFAMC } from "../src/calc/famc";

// Declarative scheduled task for Trigger.dev v4
export const famcCron = schedules.task({
  id: "famc-cron",
  cron: (() => {
    const cfg = loadAppConfig();
    // Prefer explicit object to support timezone if provided
    if (cfg.cronTimezone) {
      return { pattern: cfg.cronSchedule, timezone: cfg.cronTimezone } as const;
    }
    return cfg.cronSchedule;
  })(),
  run: async () => {
    const cfg = loadAppConfig();
    const assets = cfg.assetConfigFilePath
      ? loadAssetsFromConfigFile(cfg.assetConfigFilePath)
      : loadAssetsFromEnv();
    // Backfill missing price rows into DB per asset, then compute FAMC
    const nowSec = Math.floor(Date.now() / 1000);
    const defaultLookbackDays = Number(process.env.CRON_BACKFILL_DAYS || 7);
    const defaultFromSec = nowSec - defaultLookbackDays * 86400;

    for (const asset of assets) {
      if (!asset.coingeckoId) continue;
      const last = await prisma.price.findFirst({
        where: { symbol: asset.symbol, source: "coingecko" },
        orderBy: { priceTimestamp: "desc" },
        select: { priceTimestamp: true }
      });
      const fromUnix = last ? Math.floor(last.priceTimestamp.getTime() / 1000) + 1 : defaultFromSec;
      const toUnix = nowSec;
      if (fromUnix > toUnix) continue;
      const points = await fetchCoinGeckoRangeUSD(asset.coingeckoId, fromUnix, toUnix);
      if (points.length === 0) continue;
      const rows = points.map(p => ({
        symbol: asset.symbol,
        source: "coingecko" as const,
        price: p.price.toString(),
        priceTimestamp: p.timestampIso
      }));
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        await prisma.price.createMany({ data: chunk, skipDuplicates: true });
      }
    }

    const priceMap = await fetchCoinGeckoPrices(assets);
    const computed = assets.map(asset => {
      const quote = priceMap.get(asset.symbol);
      if (!quote) {
        throw new Error(`Missing price for ${asset.symbol}. Provide coingeckoId.`);
      }
      return computeFAMC(asset, quote);
    });
    const famcSum = computed.reduce((sum, a) => sum + a.famc, 0);
    const runAt = new Date().toISOString();
    return {
      famcSum,
      assets: computed.length,
      runAt
    };
  }
});



