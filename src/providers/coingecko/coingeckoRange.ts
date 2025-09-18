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
  // Free plan cannot use interval=daily; omit interval and aggregate to daily locally
  const interval = process.env.CG_RANGE_INTERVAL || "";
  const perDay = new Map<number, { tsMs: number; price: number; volume: number }>();

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
      if (typeof volume !== "number") continue;
      const dayStartMs = Math.floor(tsMs / 86400000) * 86400000; // UTC day bucket
      const existing = perDay.get(dayStartMs);
      if (!existing || tsMs >= existing.tsMs) {
        perDay.set(dayStartMs, { tsMs, price, volume });
      }
    }
    cursor = chunkEnd + 1;
  }
  const out: { timestampIso: string; price: number; volume: number; }[] = [];
  const sorted = Array.from(perDay.values()).sort((a, b) => a.tsMs - b.tsMs);
  for (const row of sorted) out.push({ timestampIso: new Date(row.tsMs).toISOString(), price: row.price, volume: row.volume });
  return out;
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = Number(process.env.CG_RETRIES || 4)) {
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
    // Respect Retry-After for 429 if present, otherwise exponential backoff with jitter
    let backoffMs = 0;
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        backoffMs = Math.min(10000, Math.max(500, retryAfter * 1000));
      } else {
        backoffMs = Math.min(10000, 500 * Math.pow(2, attempt));
      }
    } else if (res.status >= 500) {
      backoffMs = Math.min(8000, 400 * Math.pow(2, attempt));
    } else {
      // For 4xx other than 429, retry limited times with small delay
      backoffMs = Math.min(3000, 300 * (attempt + 1));
    }
    // Add jitter +/- 20%
    const jitter = 0.2 * backoffMs;
    backoffMs = Math.floor(backoffMs + (Math.random() * 2 - 1) * jitter);
    await new Promise(r => setTimeout(r, backoffMs));
    attempt++;
  }
  throw lastErr;
}

