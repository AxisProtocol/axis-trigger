import dotenv from "dotenv";
dotenv.config();

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { swaggerUI } from '@hono/swagger-ui'
import { prisma } from "./db/client";
import { loadAppConfig } from "./config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv } from "./providers/envAssets";
import { computeFreeFloat } from "./calc/famc";
import { openapiSpec } from "./openapi";
import { createBaseApp } from "./app";

type Resolution = "1" | "5" | "15" | "60" | "240" | "D";

const RES_TO_SEC: Record<Resolution, number> = {
  "1": 60,
  "5": 300,
  "15": 900,
  "60": 3600,
  "240": 14400,
  "D": 86400
};

function toUnixSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function toBucketStart(unixSec: number, intervalSec: number): number {
  return Math.floor(unixSec / intervalSec) * intervalSec;
}

async function loadAssetFreeFloats(): Promise<{ symbols: string[]; freeFloatBySymbol: Map<string, number>; }> {
  const cfg = loadAppConfig();
  const assets = cfg.assetConfigFilePath ? loadAssetsFromConfigFile(cfg.assetConfigFilePath) : loadAssetsFromEnv();
  const freeFloatBySymbol = new Map<string, number>();
  for (const a of assets) {
    const { freeFloat } = computeFreeFloat(a);
    freeFloatBySymbol.set(a.symbol, freeFloat);
  }
  const symbols = assets.map(a => a.symbol);
  return { symbols, freeFloatBySymbol };
}

async function computeIndexSeries(fromSec: number, toSec: number, resolution: Resolution): Promise<{ t: number[]; c: number[]; }>
{
  const { symbols, freeFloatBySymbol } = await loadAssetFreeFloats();
  const intervalSec = RES_TO_SEC[resolution];

  const prices = await prisma.price.findMany({
    where: {
      symbol: { in: symbols },
      priceTimestamp: { gte: new Date(fromSec * 1000), lte: new Date(toSec * 1000) }
    },
    orderBy: { priceTimestamp: "asc" }
  });

  // Forward-fill last known price across buckets
  const lastPriceBySymbol = new Map<string, number>();
  let cursorIdx = 0;
  const t: number[] = [];
  const c: number[] = [];
  for (let bucketStart = toBucketStart(fromSec, intervalSec); bucketStart <= toSec; bucketStart += intervalSec) {
    const bucketEnd = bucketStart + intervalSec - 1;
    while (cursorIdx < prices.length) {
      const row = prices[cursorIdx];
      const tsSec = toUnixSeconds(row.priceTimestamp);
      if (tsSec > bucketEnd) break;
      lastPriceBySymbol.set(row.symbol, Number(row.price));
      cursorIdx += 1;
    }
    if (symbols.every(s => lastPriceBySymbol.has(s))) {
      let sum = 0;
      for (const s of symbols) {
        const ff = freeFloatBySymbol.get(s) || 0;
        const p = lastPriceBySymbol.get(s) as number;
        sum += ff * p;
      }
      t.push(bucketStart);
      c.push(sum);
    }
  }
  return { t, c };
}

const app = createBaseApp();

// Simple JSON index API
app.get("/api/index", async c => {
  const from = Number(c.req.query("from")) || Math.floor(new Date(Date.now() - 7 * 86400_000).getTime() / 1000);
  const to = Number(c.req.query("to")) || Math.floor(Date.now() / 1000);
  const resolution = (c.req.query("resolution") as Resolution) || "60";
  const { t, c: values } = await computeIndexSeries(from, to, resolution);
  return c.json({ t, value: values, resolution });
});

app.get("/tv/history", async c => {
  const symbol = (c.req.query("symbol") || "INDEX:FAMC").toUpperCase();
  const resolution = (c.req.query("resolution") as Resolution) || "60";
  const from = Number(c.req.query("from"));
  const to = Number(c.req.query("to"));
  if (!from || !to) {
    return c.json({ s: "error", errmsg: "from/to required (unix seconds)" }, 400);
  }
  const { t, c: values } = await computeIndexSeries(from, to, resolution);
  if (t.length === 0) return c.json({ s: "no_data" });
  // Use close-only series; derive OHLC as flat
  const o = values.slice();
  const h = values.slice();
  const l = values.slice();
  const v = new Array(values.length).fill(0);
  return c.json({ s: "ok", t, c: values, o, h, l, v, symbol });
});

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`Server listening on http://localhost:${port}`);


