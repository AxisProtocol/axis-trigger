import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { prisma } from "../db/client";
import { getCoinGeckoBaseUrl, getCoinGeckoHeaders } from "../providers/prices/cgHeaders";

interface MarketsItem {
  id: string;
  symbol: string;
  name: string;
  circulating_supply: number | null;
}

const DEFAULT_SYMBOLS = [
  "BTC", "ETH", "SOL", "BNB", "XRP",
  "DOGE", "ADA", "AVAX", "TRX", "SUI",
];

const DEFAULT_SYMBOL_TO_CG_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  TRX: "tron",
  SUI: "sui",
};

async function fetchCirculatingSupplies(ids: string[]): Promise<Map<string, number>> {
  const base = getCoinGeckoBaseUrl();
  const headers = getCoinGeckoHeaders();
  const perPage = 250; // API max
  const result = new Map<string, number>();

  for (let i = 0; i < ids.length; i += perPage) {
    const slice = ids.slice(i, i + perPage);
    const url = `${base}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(slice.join(","))}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`CoinGecko markets fetch failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as MarketsItem[];
    for (const item of data) {
      if (typeof item.circulating_supply === "number" && Number.isFinite(item.circulating_supply)) {
        result.set(item.id, item.circulating_supply);
      }
    }
  }

  return result;
}

function resolveSymbols(): string[] {
  const fromEnv = (process.env.ASSETS || "")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_SYMBOLS;
}

function resolveCoinGeckoId(symbol: string): string {
  const envKey = process.env[`${symbol}_COINGECKO_ID`];
  if (envKey && envKey.trim()) return envKey.trim();
  const mapped = DEFAULT_SYMBOL_TO_CG_ID[symbol];
  if (!mapped) throw new Error(`No CoinGecko ID mapping for symbol ${symbol}. Provide ${symbol}_COINGECKO_ID env.`);
  return mapped;
}

async function main(): Promise<void> {
  const symbols = resolveSymbols();
  const ids = symbols.map(resolveCoinGeckoId);
  const supplyById = await fetchCirculatingSupplies(ids);

  const assets = symbols.map(symbol => {
    const id = resolveCoinGeckoId(symbol);
    const circulatingSupply = supplyById.get(id);
    if (circulatingSupply === undefined) {
      throw new Error(`Missing circulating supply for ${symbol} (id=${id}).`);
    }
    return {
      symbol,
      coingeckoId: id,
      circulatingSupply,
      foundationHoldings: 0,
      lockedSupply: 0,
      heavilyVestedStaked: 0,
      exchangeCustodyHoldings: 0,
    };
  });

  const output = { assets };
  const target = path.resolve(process.cwd(), "assets.config.json");
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + "\n", "utf-8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${assets.length} assets to ${target}`);

  // Upsert into DB as well
  for (const a of assets) {
    await prisma.asset.upsert({
      where: { symbol: a.symbol },
      create: {
        symbol: a.symbol,
        coingeckoId: a.coingeckoId,
        circulatingSupply: a.circulatingSupply.toString(),
        foundationHoldings: a.foundationHoldings.toString(),
        lockedSupply: a.lockedSupply.toString(),
        heavilyVestedStaked: a.heavilyVestedStaked.toString(),
        exchangeCustodyHoldings: a.exchangeCustodyHoldings.toString(),
      },
      update: {
        coingeckoId: a.coingeckoId,
        circulatingSupply: a.circulatingSupply.toString(),
        foundationHoldings: a.foundationHoldings.toString(),
        lockedSupply: a.lockedSupply.toString(),
        heavilyVestedStaked: a.heavilyVestedStaked.toString(),
        exchangeCustodyHoldings: a.exchangeCustodyHoldings.toString(),
      },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Upserted ${assets.length} assets into database.`);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


