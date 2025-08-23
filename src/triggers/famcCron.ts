import { schedules } from "@trigger.dev/sdk";
import { loadAppConfig } from "../config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv } from "../providers/envAssets";
import { fetchCoinGeckoPrices } from "../providers/prices/coingecko";
import { computeFAMC } from "../calc/famc";

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


