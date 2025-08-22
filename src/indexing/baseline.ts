import fs from "fs";
import path from "path";

export interface BaselineAssetEntry {
  symbol: string;
  basePrice: number;
  baseTimestamp: string;
}

export interface BaselineFile {
  createdAt: string;
  assets: BaselineAssetEntry[];
  sumOfRatiosAtBase: number; // always equals number of assets (since ratio at base = 1), but we keep explicit
}

export function getBaselinePath(): string {
  const configured = process.env.INDEX_BASELINE_FILE;
  const resolved = configured
    ? path.resolve(process.cwd(), configured)
    : path.resolve(process.cwd(), "output/baseline.json");
  return resolved;
}

export function ensureBaseline(assets: { symbol: string; currentPrice: number; priceTimestamp: string }[]): BaselineFile {
  const p = getBaselinePath();
  if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as BaselineFile;
  }
  const createdAt = new Date().toISOString();
  const entries: BaselineAssetEntry[] = assets.map(a => ({
    symbol: a.symbol,
    basePrice: a.currentPrice,
    baseTimestamp: a.priceTimestamp
  }));
  // At base, each ratio = 1, sum = num assets
  const sumOfRatiosAtBase = entries.length;
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file: BaselineFile = { createdAt, assets: entries, sumOfRatiosAtBase };
  fs.writeFileSync(p, JSON.stringify(file, null, 2), "utf-8");
  return file;
}

export function lookupBasePrice(baseline: BaselineFile, symbol: string): number | undefined {
  const found = baseline.assets.find(a => a.symbol === symbol);
  return found?.basePrice;
}

