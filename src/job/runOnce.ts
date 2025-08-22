import { loadAppConfig } from "../config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv } from "../providers/envAssets";
import { computeFAMC } from "../calc/famc";
import { writeRunOutput, type RunResult } from "../io/output";
import { fetchCoinGeckoPrices } from "../providers/prices/coingecko";
import { ensureBaseline, lookupBasePrice } from "../indexing/baseline";

export async function runComputation(): Promise<RunResult> {
  const cfg = loadAppConfig();
  const assets = cfg.assetConfigFilePath ? loadAssetsFromConfigFile(cfg.assetConfigFilePath) : loadAssetsFromEnv();
  const priceMap = await fetchCoinGeckoPrices(assets);
  const computed = assets.map(asset => {
    const quote = priceMap.get(asset.symbol);
    if (!quote) {
      throw new Error(`Missing price for ${asset.symbol}. Provide coingeckoId or price source.`);
    }
    return computeFAMC(asset, quote);
  });
  const famcSum = computed.reduce((sum, a) => sum + a.famc, 0);
  const now = new Date();
  const runAt = now.toISOString();
  // Build index-like breakdown similar to data.csv
  const baseline = ensureBaseline(
    computed.map(a => ({ symbol: a.symbol, currentPrice: a.price, priceTimestamp: a.priceTimestamp }))
  );
  const breakdownAssets = computed.map(a => {
    const basePrice = lookupBasePrice(baseline, a.symbol) ?? a.price;
    const ratio = basePrice > 0 ? a.price / basePrice : 0;
    return {
      symbol: a.symbol,
      ratio,
      basePrice,
      currentPrice: a.price
    };
  });
  const sumOfRatios = breakdownAssets.reduce((s, x) => s + x.ratio, 0);
  // Normalize index to 100 at baseline: if baseline sum equals number of assets, index = (sumOfRatios / N) * 100
  const numAssets = breakdownAssets.length || 1;
  const indexValue = (sumOfRatios / numAssets) * 100;

  const result: RunResult = {
    runAt,
    timezone: cfg.cronTimezone,
    assets: computed,
    totals: { famcSum },
    index: {
      indexValue,
      calculationBreakdown: {
        assets: breakdownAssets,
        sumOfRatios
      }
    }
  };
  writeRunOutput(result);
  return result;
}

