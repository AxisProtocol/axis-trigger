import { type AssetInput, type PriceQuote, assetInputSchema } from "../../types";
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

// Fetch the top assets by market capitalization from CoinGecko. This returns
// AssetInput objects suitable for the current system. By default, common
// stablecoins are excluded to better reflect investable universe.
interface MarketsRow {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  circulating_supply: number | null;
}

const STABLE_SYMBOLS = new Set([
  "usdt","usdc","dai","tusd","fdusd","usde","usdd","busd","gusd","usdp","pyusd","susd","lusd"
]);

export async function fetchTopByMarketCap(limit = 10, options?: { excludeStable?: boolean }): Promise<AssetInput[]> {
  const base = getCoinGeckoBaseUrl();
  const headers = getCoinGeckoHeaders();
  const perPage = Math.max(1, Math.min(250, limit));
  const url = `${base}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false&price_change_percentage=0`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CoinGecko markets fetch failed: ${res.status} ${res.statusText} ${body}`);
  }
  const rows = (await res.json()) as MarketsRow[];

  const excludeStable = options?.excludeStable !== false;
  const filtered = rows.filter(r => {
    if (!r.id || !r.symbol) return false;
    if (excludeStable && STABLE_SYMBOLS.has(r.symbol.toLowerCase())) return false;
    return Number.isFinite(r.circulating_supply || 0) && (r.circulating_supply as number) > 0;
  }).slice(0, limit);

  const assets: AssetInput[] = filtered.map(r => assetInputSchema.parse({
    symbol: (r.symbol || r.id).toUpperCase(),
    coingeckoId: r.id,
    circulatingSupply: r.circulating_supply as number,
    foundationHoldings: 0,
    lockedSupply: 0,
    heavilyVestedStaked: 0,
    exchangeCustodyHoldings: 0
  }));

  return assets;
}

// Minimal tickers type to estimate trusted exchange coverage.
interface CoinTickerRow {
  market: { name: string };
  trust_score?: string; // 'green' on CoinGecko for high-quality markets
  is_stale?: boolean;
  is_anomaly?: boolean;
}

/**
 * Counts unique trusted exchanges listing the asset based on CoinGecko tickers.
 * We treat tickers with trust_score === 'green' and not stale/anomalous as valid.
 */
export async function fetchTrustedExchangeCount(coingeckoId: string): Promise<number> {
  const base = getCoinGeckoBaseUrl();
  const headers = getCoinGeckoHeaders();
  const url = `${base}/coins/${encodeURIComponent(coingeckoId)}/tickers?include_exchange_logo=false&page=1`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CoinGecko tickers fetch failed: ${res.status} ${res.statusText} ${body}`);
  }
  const json = await res.json() as { tickers?: CoinTickerRow[] };
  const set = new Set<string>();
  for (const t of (json.tickers || [])) {
    if (!t || !t.market || !t.market.name) continue;
    if (t.trust_score !== "green") continue;
    if (t.is_stale === true || t.is_anomaly === true) continue;
    set.add(t.market.name);
  }
  return set.size;
}

/**
 * Fetches the coin's genesis date (YYYY-MM-DD) if available. Used to screen age.
 */
export async function fetchGenesisDate(coingeckoId: string): Promise<string | undefined> {
  const base = getCoinGeckoBaseUrl();
  const headers = getCoinGeckoHeaders();
  const query = `?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`;
  const res = await fetch(`${base}/coins/${encodeURIComponent(coingeckoId)}${query}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CoinGecko coin detail fetch failed: ${res.status} ${res.statusText} ${body}`);
  }
  const data = await res.json() as { genesis_date?: string | null };
  return data.genesis_date || undefined;
}
