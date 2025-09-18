import { getCoinGeckoHeaders, getCoinGeckoBaseUrl } from "./cgHeaders";

interface MarketChartRangeResponse {
  prices: [number, number][]; // [timestamp(ms), price]
  total_volumes?: [number, number][]; // [timestamp(ms), volume]
}

export async function fetchCoinGeckoRangeUSD(coingeckoId: string, fromUnixSec: number, toUnixSec: number): Promise<{ timestampIso: string; price: number; }[]> {
  const base = getCoinGeckoBaseUrl();
  const headers = getCoinGeckoHeaders();
  const maxSpanDays = Number(process.env.CG_RANGE_MAX_DAYS || 30); // chunk to avoid API limits
  const interval = process.env.CG_RANGE_INTERVAL || ""; // e.g., 'daily' to reduce points
  const results: { timestampIso: string; price: number; }[] = [];
  let cursor = fromUnixSec;
  while (cursor <= toUnixSec) {
    const chunkEnd = Math.min(toUnixSec, cursor + maxSpanDays * 86400);
    const url = `${base}/coins/${encodeURIComponent(coingeckoId)}/market_chart/range?vs_currency=usd&from=${cursor}&to=${chunkEnd}${interval ? `&interval=${encodeURIComponent(interval)}` : ""}`;
    const data = await fetchWithRetry(url, { headers });
    for (const [tsMs, price] of (data.prices ?? [])) {
      results.push({ timestampIso: new Date(tsMs).toISOString(), price });
    }
    cursor = chunkEnd + 1;
  }
  return results;
}

/**
 * Fetches daily USD prices AND volumes for an asset from CoinGecko within a
 * time range. This is used for liquidity metrics such as TR90. The function
 * chunks the range to respect API limits and uses an optional `CG_RANGE_INTERVAL`
 * (defaults to 'daily') to reduce returned points to daily closes.
 */
export async function fetchCoinGeckoRangeUSDWithVolumes(
  coingeckoId: string,
  fromUnixSec: number,
  toUnixSec: number
): Promise<{ timestampIso: string; price: number; volume: number; }[]> {
  const base = getCoinGeckoBaseUrl();
  const headers = getCoinGeckoHeaders();
  const maxSpanDays = Number(process.env.CG_RANGE_MAX_DAYS || 30);
  const interval = process.env.CG_RANGE_INTERVAL || "daily";
  const out: { timestampIso: string; price: number; volume: number; }[] = [];

  let cursor = fromUnixSec;
  while (cursor <= toUnixSec) {
    const chunkEnd = Math.min(toUnixSec, cursor + maxSpanDays * 86400);
    const url = `${base}/coins/${encodeURIComponent(coingeckoId)}/market_chart/range?vs_currency=usd&from=${cursor}&to=${chunkEnd}${interval ? `&interval=${encodeURIComponent(interval)}` : ""}`;
    const data = await fetchWithRetry(url, { headers });

    const priceMap = new Map<number, number>();
    const volumeMap = new Map<number, number>();
    for (const [tsMs, p] of (data.prices ?? [])) priceMap.set(tsMs, p);
    for (const [tsMs, v] of (data.total_volumes ?? [])) volumeMap.set(tsMs, v);

    for (const [tsMs, price] of priceMap.entries()) {
      const volume = volumeMap.get(tsMs);
      if (typeof volume === "number") {
        out.push({ timestampIso: new Date(tsMs).toISOString(), price, volume });
      }
    }
    cursor = chunkEnd + 1;
  }
  return out;
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = Number(process.env.CG_RETRIES || 2)) {
  let attempt = 0;
  let lastErr: any;
  while (attempt <= maxRetries) {
    const res = await fetch(url, init);
    if (res.ok) {
      return (await res.json()) as MarketChartRangeResponse;
    }
    let body = "";
    try { body = await res.text(); } catch {}
    lastErr = new Error(`CoinGecko range fetch failed: ${res.status} ${res.statusText} ${body}`);
    const backoffMs = Math.min(2000, 200 * Math.pow(2, attempt));
    await new Promise(r => setTimeout(r, backoffMs));
    attempt++;
  }
  throw lastErr;
}

