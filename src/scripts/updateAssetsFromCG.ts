import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { prisma } from "../db/client";
import { getCoinGeckoBaseUrl, getCoinGeckoHeaders } from "../providers/coingecko/cgHeaders";

interface CoinDetailResponse {
  id: string;
  symbol: string; // e.g. "btc"
  name: string;
  market_data?: {
    circulating_supply?: number | null;
  };
}

const DEFAULT_COINGECKO_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "binancecoin",
  "ripple",
  "dogecoin",
  "cardano",
  "avalanche-2",
  "tron",
  "sui",
];

function resolveCoinGeckoIds(): string[] {
  const raw = (process.env.COINGECKO_IDS || process.env.COIN_IDS || process.env.ASSETS || "");
  const ids = raw
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return ids.length > 0 ? ids : DEFAULT_COINGECKO_IDS;
}

async function fetchCoinDetailsByIds(ids: string[]): Promise<Map<string, CoinDetailResponse>> {
  const base = getCoinGeckoBaseUrl();
  const headers = getCoinGeckoHeaders();
  const query = "?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false";

  const results = await Promise.all(ids.map(async (id) => {
    const res = await fetch(`${base}/coins/${encodeURIComponent(id)}${query}`, { headers });
    if (!res.ok) {
      throw new Error(`CoinGecko coin detail fetch failed for id=${id}: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as CoinDetailResponse;
    return [id, data] as const;
  }));

  return new Map(results);
}

async function main(): Promise<void> {
  const ids = resolveCoinGeckoIds();
  const detailById = await fetchCoinDetailsByIds(ids);

  const assets = ids.map(id => {
    const detail = detailById.get(id);
    if (!detail) throw new Error(`Missing coin detail for id=${id}`);
    const supply = detail.market_data?.circulating_supply;
    if (typeof supply !== "number" || !Number.isFinite(supply)) {
      throw new Error(`Missing circulating_supply for id=${id}`);
    }
    const symbol = (detail.symbol || id).toUpperCase();
    return {
      symbol,
      coingeckoId: id,
      circulatingSupply: supply,
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


