import type { Hono } from "hono";
import { computeIndexSeries, SUPPORTED_RESOLUTIONS, loadAssetFreeFloats } from "../services/indexSeries";
import type { Resolution } from "../services/indexSeries";
import { loadAppConfig } from "../config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv } from "../providers/envAssets";
import { prisma } from "../db/client";

// Base day reference prices for equal-weight index computation
const baseDayData = {
  sumOfRatios: 27.431066558841906,
  assets: [
    { symbol: "BTC", basePrice: 42739.27 },
    { symbol: "ETH", basePrice: 2528.09 },
    { symbol: "XRP", basePrice: 0.568 },
    { symbol: "BNB", basePrice: 309.09 },
    { symbol: "SOL", basePrice: 102.07 },
    { symbol: "DOGE", basePrice: 0.08053 },
    { symbol: "TRX", basePrice: 0.1083 },
    { symbol: "ADA", basePrice: 0.5278 },
    { symbol: "SUI", basePrice: 1.292 },
    { symbol: "AVAX", basePrice: 36.03 },
  ],
} as const;

export function registerIndexRoutes(app: Hono): void {
  app.get("/api/famc", async c => {
    const from = Number(c.req.query("from")) || Math.floor(new Date(Date.now() - 7 * 86400_000).getTime() / 1000);
    const to = Number(c.req.query("to")) || Math.floor(Date.now() / 1000);
    const resolution = (c.req.query("resolution") as Resolution) || "60";
    if (!SUPPORTED_RESOLUTIONS.includes(resolution)) {
      return c.json({ message: "invalid resolution" }, 400);
    }
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
    if (!SUPPORTED_RESOLUTIONS.includes(resolution)) {
      return c.json({ s: "error", errmsg: "invalid resolution" }, 400);
    }
    const { t, c: values } = await computeIndexSeries(from, to, resolution);
    if (t.length === 0) return c.json({ s: "no_data" });
    const o = values.slice();
    const h = values.slice();
    const l = values.slice();
    const v = new Array(values.length).fill(0);
    return c.json({ s: "ok", t, c: values, o, h, l, v, symbol });
  });

  // Equal-weight average latest price across configured assets
  app.get("/api/avgindexprice", async c => {
    const cfg = loadAppConfig();
    const assets = cfg.assetConfigFilePath ? loadAssetsFromConfigFile(cfg.assetConfigFilePath) : loadAssetsFromEnv();
    if (assets.length === 0) return c.json({ message: "no assets configured" }, 400);
    const symbols = assets.map(a => a.symbol);
    // fetch latest price per symbol
    const rows = await prisma.$queryRawUnsafe<Array<{ symbol: string; price: string }>>(
      `
      SELECT DISTINCT ON (symbol) symbol, price
      FROM "Price"
      WHERE symbol = ANY($1)
      ORDER BY symbol, "priceTimestamp" DESC
      `,
      symbols
    );
    const latestBySymbol = new Map<string, number>();
    for (const r of rows) latestBySymbol.set(r.symbol, Number(r.price));

    // Build base price map
    const basePriceMap = new Map<string, number>(baseDayData.assets.map(a => [a.symbol, a.basePrice]));
    // Only consider assets we have both a latest price and a base price for
    const present = symbols.filter(s => latestBySymbol.has(s) && basePriceMap.has(s));
    if (present.length === 0) return c.json({ message: "no prices available" }, 404);

    // Sum of ratios current/base
    const sumOfRatios = present.reduce((sum, sym) => {
      const current = latestBySymbol.get(sym) as number;
      const base = basePriceMap.get(sym) as number;
      return sum + current / base;
    }, 0);
    // Equal-weight index normalized to 100 at base day
    const avg = 100 * (sumOfRatios / baseDayData.assets.length);
    return c.json({ avg, baseDay: baseDayData, symbols: present, count: present.length });
  });

  // FAMC index price normalized to earliest DB prices per symbol
  app.get("/api/famcindexprice", async c => {
    const cfg = loadAppConfig();
    const assets = cfg.assetConfigFilePath ? loadAssetsFromConfigFile(cfg.assetConfigFilePath) : loadAssetsFromEnv();
    if (assets.length === 0) return c.json({ message: "no assets configured" }, 400);

    const { freeFloatBySymbol } = await loadAssetFreeFloats();
    const symbols = assets.map(a => a.symbol);

    // Latest prices now
    const latestRows = await prisma.$queryRawUnsafe<Array<{ symbol: string; price: string }>>(
      `
      SELECT DISTINCT ON (symbol) symbol, price
      FROM "Price"
      WHERE symbol = ANY($1)
      ORDER BY symbol, "priceTimestamp" DESC
      `,
      symbols
    );
    const latestBySymbol = new Map<string, number>();
    for (const r of latestRows) latestBySymbol.set(r.symbol, Number(r.price));

    // Baseline prices: earliest per symbol in DB
    const baseRows = await prisma.$queryRawUnsafe<Array<{ symbol: string; price: string; priceTimestamp: Date }>>(
      `
      SELECT DISTINCT ON (symbol) symbol, price, "priceTimestamp"
      FROM "Price"
      WHERE symbol = ANY($1)
      ORDER BY symbol, "priceTimestamp" ASC
      `,
      symbols
    );
    const baseBySymbol = new Map<string, number>();
    const baseTsBySymbol = new Map<string, Date>();
    for (const r of baseRows) {
      baseBySymbol.set(r.symbol, Number(r.price));
      baseTsBySymbol.set(r.symbol, r.priceTimestamp);
    }

    // Only include symbols with prices for both baseline and latest, and a defined free float
    const present = symbols.filter(s => latestBySymbol.has(s) && baseBySymbol.has(s) && freeFloatBySymbol.has(s));
    if (present.length === 0) return c.json({ message: "no prices available for baseline and latest" }, 404);

    let baseIndex = 0;
    let currentIndex = 0;
    for (const s of present) {
      const ff = freeFloatBySymbol.get(s) || 0;
      const pBase = baseBySymbol.get(s) as number;
      const pNow = latestBySymbol.get(s) as number;
      baseIndex += ff * pBase;
      currentIndex += ff * pNow;
    }
    if (baseIndex === 0) return c.json({ message: "baseline index is zero" }, 400);

    const indexPrice = 100 * (currentIndex / baseIndex);
    let baseDateIso = undefined as string | undefined;
    if (present.length > 0) {
      let minTs = baseTsBySymbol.get(present[0]) as Date;
      for (const s of present) {
        const ts = baseTsBySymbol.get(s);
        if (ts && ts < minTs) minTs = ts;
      }
      baseDateIso = minTs.toISOString();
    }
    return c.json({ indexPrice, baseDate: baseDateIso, baseIndex, currentIndex, symbols: present, count: present.length });
  });
}


