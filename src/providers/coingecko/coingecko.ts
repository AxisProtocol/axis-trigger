import { fetch } from "undici";
import { type AssetInput, type PriceQuote } from "../../types";
import { getCoinGeckoHeaders, getCoinGeckoBaseUrl } from "./cgHeaders";

interface CoinGeckoSimplePriceResponse {
  [id: string]: {
    usd: number;
    last_updated_at?: number; // seconds since epoch
  };
}

export async function fetchCoinGeckoPrices(assets: AssetInput[]): Promise<Map<string, PriceQuote>> {
  const idToSymbol = new Map<string, string>();
  const ids: string[] = [];
  for (const a of assets) {
    if (a.coingeckoId) {
      ids.push(a.coingeckoId);
      idToSymbol.set(a.coingeckoId, a.symbol);
    }
  }
  if (ids.length === 0) {
    return new Map();
  }
  const base = getCoinGeckoBaseUrl();
  const url = `${base}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd&include_last_updated_at=true`;
  const res = await fetch(url, { headers: getCoinGeckoHeaders() });
  if (!res.ok) {
    throw new Error(`CoinGecko price fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as CoinGeckoSimplePriceResponse;
  const nowIso = new Date().toISOString();
  const map = new Map<string, PriceQuote>();
  for (const [id, payload] of Object.entries(data)) {
    const symbol = idToSymbol.get(id);
    if (!symbol) continue;
    const ts = payload.last_updated_at ? new Date(payload.last_updated_at * 1000).toISOString() : nowIso;
    map.set(symbol, {
      symbol,
      price: payload.usd,
      source: "coingecko",
      priceTimestamp: ts
    });
  }
  return map;
}
