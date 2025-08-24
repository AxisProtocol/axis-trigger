export function getCoinGeckoHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Accept": "application/json", "User-Agent": "axis-trigger/0.1.0" };
  const proKey = process.env.COINGECKO_PRO_API_KEY;
  const pubKey = process.env.COINGECKO_API_KEY || process.env.X_CG_API_KEY;
  if (proKey) {
    headers["x-cg-pro-api-key"] = proKey;
  }
  if (pubKey) {
    headers["x-cg-api-key"] = pubKey;
    headers["x-cg-apikey"] = pubKey;
    headers["x-cg-demo-api-key"] = pubKey;
  }
  return headers;
}

export function getCoinGeckoBaseUrl(): string {
  const override = process.env.COINGECKO_BASE_URL;
  if (override) return override;
  const usePro = !!process.env.COINGECKO_PRO_API_KEY || process.env.COINGECKO_USE_PRO === "true";
  return usePro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
}


export function getCoinGeckoHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Accept": "application/json", "User-Agent": "axis-trigger/0.1.0" };
  const proKey = process.env.COINGECKO_PRO_API_KEY;
  const pubKey = process.env.COINGECKO_API_KEY || process.env.X_CG_API_KEY;
  if (proKey) {
    headers["x-cg-pro-api-key"] = proKey;
  }
  if (pubKey) {
    headers["x-cg-api-key"] = pubKey;
    headers["x-cg-apikey"] = pubKey;
    headers["x-cg-demo-api-key"] = pubKey;
  }
  return headers;
}

export function getCoinGeckoBaseUrl(): string {
  const override = process.env.COINGECKO_BASE_URL;
  if (override) return override;
  const usePro = !!process.env.COINGECKO_PRO_API_KEY || process.env.COINGECKO_USE_PRO === "true";
  return usePro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
}


