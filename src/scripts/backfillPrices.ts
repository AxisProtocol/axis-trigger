import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../db/client";
import { loadAppConfig } from "../config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv } from "../providers/envAssets";
import { fetchCoinGeckoRangeUSD } from "../providers/prices/coingeckoRange";

function parseStartDateEnv(): Date {
  const raw = process.env.START_DATE ?? "2024-08-01";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid START_DATE: ${raw}`);
  }
  return d;
}

async function main(): Promise<void> {
  const startDate = parseStartDateEnv();
  const endDate = new Date();

  const cfg = loadAppConfig();
  const assets = cfg.assetConfigFilePath ? loadAssetsFromConfigFile(cfg.assetConfigFilePath) : loadAssetsFromEnv();

  const fromUnix = Math.floor(startDate.getTime() / 1000);
  const toUnix = Math.floor(endDate.getTime() / 1000);

  for (const asset of assets) {
    if (!asset.coingeckoId) {
      console.warn(`Skipping ${asset.symbol}: missing coingeckoId`);
      continue;
    }
    console.log(`Fetching ${asset.symbol} (${asset.coingeckoId}) from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    const points = await fetchCoinGeckoRangeUSD(asset.coingeckoId, fromUnix, toUnix);
    if (points.length === 0) {
      console.log(`No points returned for ${asset.symbol}`);
      continue;
    }

    const rows = points.map(p => ({
      symbol: asset.symbol,
      source: "coingecko",
      price: p.price.toString(),
      priceTimestamp: p.timestampIso
    }));

    // Insert in chunks to avoid exceeding parameter limits
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await prisma.price.createMany({ data: chunk, skipDuplicates: true });
      console.log(`Inserted ${Math.min(chunk.length, rows.length - i)} rows for ${asset.symbol} (${i + chunk.length}/${rows.length})`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });


