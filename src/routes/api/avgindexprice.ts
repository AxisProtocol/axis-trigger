import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { loadAppConfig } from "../../config";
import { loadAssetsFromBundledConfig, loadAssetsFromEnv } from "../../providers/envAssets";

const ResponseSchema = z.object({
  avg: z.number(),
  baseDay: z.object({
    sumOfRatios: z.number(),
    assets: z.array(z.object({ symbol: z.string(), basePrice: z.number() }))
  }),
  symbols: z.array(z.string()),
  count: z.number().int(),
});

const ErrorSchema = z.object({ message: z.string() });

const route = createRoute({
  method: "get",
  path: "/avgindexprice",
  responses: {
    200: { description: "Average across available symbols", content: { "application/json": { schema: ResponseSchema } } },
    400: { description: "No assets configured", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "No prices available", content: { "application/json": { schema: ErrorSchema } } },
  },
});

// Base day reference prices (copied from previous implementation)
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

export const avgindexprice = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const cfg = loadAppConfig();
  // Merge env and bundled assets; env overrides by symbol
  const envAssets = loadAssetsFromEnv();
  const bundledAssets = loadAssetsFromBundledConfig();
  const bySymbol = new Map<string, any>();
  for (const a of bundledAssets) bySymbol.set(a.symbol, a);
  for (const a of envAssets) bySymbol.set(a.symbol, a);
  const assets = Array.from(bySymbol.values());
  if (assets.length === 0) return c.json({ message: "no assets configured" }, 400) as any;
  const symbols = assets.map(a => a.symbol);
  const prisma = (c.get("prisma") as unknown) as PrismaLike;
  // SQLite (D1) equivalent to get latest row per symbol
  const placeholders = symbols.map(() => '?').join(',');
  const sql = `
    WITH ranked AS (
      SELECT symbol, price, priceTimestamp,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY priceTimestamp DESC) AS rn
      FROM Price
      WHERE symbol IN (${placeholders})
    )
    SELECT symbol, price FROM ranked WHERE rn = 1
  `;
  const rows = await (prisma as any).$queryRawUnsafe(
    sql,
    ...symbols
  ) as Array<{ symbol: string; price: string }>;
  const latestBySymbol = new Map<string, number>();
  for (const r of rows) latestBySymbol.set(r.symbol, Number(r.price));
  const basePriceMap = new Map<string, number>(baseDayData.assets.map(a => [a.symbol, a.basePrice]));
  const present = symbols.filter(s => latestBySymbol.has(s) && basePriceMap.has(s));
  if (present.length === 0) return c.json({ message: "no prices available" }, 404) as any;
  const sumOfRatios = present.reduce((sum, sym) => {
    const current = latestBySymbol.get(sym) as number;
    const base = basePriceMap.get(sym) as number;
    return sum + current / base;
  }, 0);
  const avg = 100 * (sumOfRatios / baseDayData.assets.length);
  return c.json({ avg, baseDay: baseDayData, symbols: present, count: present.length }) as any;
});


