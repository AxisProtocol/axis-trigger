import { type AssetInput } from "../types";
import { fetchCoinGeckoRangeUSDWithVolumes } from "../providers/coingecko/coingeckoRange";

/**
 * Computes TR90 (90-day turnover) using CoinGecko daily total volumes divided
 * by the average FAMC over the same window. Also returns daily turnover ratios
 * for continuity checks. This uses a simple free-float estimate based on the
 * asset input if per-day free-float is not maintained.
 */
export async function computeTR90FromCG(
  asset: AssetInput,
  fromUnixSec: number,
  toUnixSec: number
): Promise<{
  tr90: number;
  dailyTurnovers: number[];
  days: number;
}> {
  if (!asset.coingeckoId) throw new Error(`Missing coingeckoId for ${asset.symbol}`);
  const rows = await fetchCoinGeckoRangeUSDWithVolumes(asset.coingeckoId, fromUnixSec, toUnixSec);

  // Free float approximation. Note: Avoid double counting exchange custody unless
  // it's known to be excluded from circulating supply.
  const freeFloat = Math.max(
    0,
    asset.circulatingSupply - (asset.foundationHoldings + asset.lockedSupply + asset.heavilyVestedStaked) + asset.exchangeCustodyHoldings
  );

  const vols = rows.map(r => r.volume).filter(v => Number.isFinite(v));
  const sorted = [...vols].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const cap = median > 0 ? 10 * median : Infinity; // outlier cap

  let sumVol = 0;
  let sumFamc = 0;
  const dailyTurnovers: number[] = [];
  for (const r of rows) {
    const vol = Math.min(r.volume, cap);
    const famc = freeFloat * r.price;
    if (famc > 0) dailyTurnovers.push(vol / famc);
    sumVol += vol;
    sumFamc += famc;
  }
  const days = rows.length;
  const avgFamc = days > 0 ? sumFamc / days : 0;
  const tr90 = avgFamc > 0 ? sumVol / avgFamc : 0;
  return { tr90, dailyTurnovers, days };
}

/**
 * Continuity check: require at least `minDays` days where daily turnover >= threshold.
 * Example: threshold=0.03 (3%), minDays=60.
 */
export function passesContinuity(dailyTurnovers: number[], threshold = 0.03, minDays = 60): boolean {
  return dailyTurnovers.filter(x => x >= threshold).length >= minDays;
}


