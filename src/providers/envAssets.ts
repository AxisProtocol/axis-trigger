import fs from "fs";
import path from "path";
import { assetConfigFileSchema, assetInputSchema, type AssetInput, type AssetConfigFile } from "../types";
// Import the bundled JSON so it is available in Cloudflare Workers (no filesystem)
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import bundledAssetConfigJson from "../../assets.config.json";

export function loadAssetsFromConfigFile(configFilePath: string): AssetInput[] {
  const resolved = path.resolve(process.cwd(), configFilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Asset config file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse JSON at ${resolved}: ${(e as Error).message}`);
  }
  const validated = assetConfigFileSchema.parse(parsed as AssetConfigFile);
  return validated.assets.map(normalizeAsset);
}

// Use the bundled JSON (works on Cloudflare Workers where fs is unavailable)
export function loadAssetsFromBundledConfig(): AssetInput[] {
  const validated = assetConfigFileSchema.parse(bundledAssetConfigJson as unknown as AssetConfigFile);
  return validated.assets.map(normalizeAsset);
}

export function loadAssetsFromEnv(): AssetInput[] {
  const assetList = (process.env.ASSETS || "").split(",").map(s => s.trim()).filter(Boolean);
  const assets: AssetInput[] = [];
  for (const symbol of assetList) {
    const upper = symbol.toUpperCase();
    const circulatingSupply = readNumberEnv(`${upper}_CIRCULATING_SUPPLY`);
    const foundationHoldings = readNumberEnv(`${upper}_FOUNDATION_HOLDINGS`, 0);
    const lockedSupply = readNumberEnv(`${upper}_LOCKED_SUPPLY`, 0);
    const heavilyVestedStaked = readNumberEnv(`${upper}_HEAVILY_VESTED`, 0);
    const exchangeCustodyHoldings = readNumberEnv(`${upper}_EXCHANGE_CUSTODY`, 0);
    const coingeckoIdEnv = process.env[`${upper}_COINGECKO_ID`];
    const binanceSymbolEnv = process.env[`${upper}_BINANCE_SYMBOL`];
    const candidate: AssetInput = {
      symbol: upper,
      coingeckoId: coingeckoIdEnv,
      binanceSymbol: binanceSymbolEnv,
      circulatingSupply,
      foundationHoldings,
      lockedSupply,
      heavilyVestedStaked,
      exchangeCustodyHoldings
    };
    const validated = assetInputSchema.parse(candidate);
    assets.push(normalizeAsset(validated));
  }
  return assets;
}

function readNumberEnv(key: string, defaultValue?: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required env var: ${key}`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Env var ${key} must be a number. Got: ${raw}`);
  }
  return value;
}

function normalizeAsset(asset: AssetInput): AssetInput {
  return { ...asset, symbol: asset.symbol.toUpperCase() };
}

