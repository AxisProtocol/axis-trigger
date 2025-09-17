import { getCoinGeckoHeaders, getCoinGeckoBaseUrl } from "./cgHeaders";

interface MarketChartRangeResponse {
  prices: [number, number][]; // [timestamp(ms), price]
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

