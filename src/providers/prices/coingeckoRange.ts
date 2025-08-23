import { fetch } from "undici";
import { getCoinGeckoHeaders, getCoinGeckoBaseUrl } from "./cgHeaders";

interface MarketChartRangeResponse {
  prices: [number, number][]; // [timestamp(ms), price]
}

export async function fetchCoinGeckoRangeUSD(coingeckoId: string, fromUnixSec: number, toUnixSec: number): Promise<{ timestampIso: string; price: number; }[]> {
  const base = getCoinGeckoBaseUrl();
  const headers = getCoinGeckoHeaders();
  const maxSpanDays = Number(process.env.CG_RANGE_MAX_DAYS || 30); // chunk to avoid API limits
  const results: { timestampIso: string; price: number; }[] = [];
  let cursor = fromUnixSec;
  while (cursor <= toUnixSec) {
    const chunkEnd = Math.min(toUnixSec, cursor + maxSpanDays * 86400);
    const url = `${base}/coins/${encodeURIComponent(coingeckoId)}/market_chart/range?vs_currency=usd&from=${cursor}&to=${chunkEnd}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch {}
      throw new Error(`CoinGecko range fetch failed for ${coingeckoId}: ${res.status} ${res.statusText} ${body}`);
    }
    const data = (await res.json()) as MarketChartRangeResponse;
    for (const [tsMs, price] of (data.prices ?? [])) {
      results.push({ timestampIso: new Date(tsMs).toISOString(), price });
    }
    cursor = chunkEnd + 1;
  }
  return results;
}


