import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { loadAppConfig } from "../../config";
import { loadAssetsFromBundledConfig, loadAssetsFromEnv } from "../../providers/envAssets";
import { loadAssetFreeFloats } from "../../utils/indexSeries";

const ResponseSchema = z.object({
  indexPrice: z.number(),
  baseDate: z.string().datetime().nullable().optional(),
  baseIndex: z.number(),
  currentIndex: z.number(),
  symbols: z.array(z.string()),
  count: z.number().int(),
});

const ErrorSchema = z.object({ message: z.string() });

const route = createRoute({
  method: "get",
  path: "/famcindexprice",
  responses: {
    200: { description: "Index price normalized to 100 at baseline", content: { "application/json": { schema: ResponseSchema } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "No prices available", content: { "application/json": { schema: ErrorSchema } } },
  },
});

export const famcindexprice = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const cfg = loadAppConfig();
  const assets = cfg.assetConfigFilePath ? loadAssetsFromBundledConfig() : loadAssetsFromEnv();
  if (assets.length === 0) return c.json({ message: "no assets configured" }, 400) as any;

  const { freeFloatBySymbol } = await loadAssetFreeFloats();
  const symbols = assets.map(a => a.symbol);
  const prisma = (c.get("prisma") as unknown) as PrismaLike;

  // Get latest prices for each symbol using Prisma ORM
  const latestPrices = await Promise.all(
    symbols.map(async (symbol) => {
      const latest = await (prisma as any).price.findFirst({
        where: { symbol },
        orderBy: { priceTimestamp: 'desc' },
        select: { symbol: true, price: true, priceTimestamp: true }
      });
      return latest;
    })
  );
  
  const latestRows = latestPrices.filter(Boolean);
  const latestBySymbol = new Map<string, number>();
  console.log(`Latest rows:`, latestRows);
  for (const r of latestRows) {
    if (r) latestBySymbol.set(r.symbol, Number(r.price));
  }

  // Get earliest prices for each symbol using Prisma ORM
  const basePrices = await Promise.all(
    symbols.map(async (symbol) => {
      const earliest = await (prisma as any).price.findFirst({
        where: { symbol },
        orderBy: { priceTimestamp: 'asc' },
        select: { symbol: true, price: true, priceTimestamp: true }
      });
      return earliest;
    })
  );
  
  const baseRows = basePrices.filter(Boolean);
  const baseBySymbol = new Map<string, number>();
  const baseTsBySymbol = new Map<string, Date>();
  for (const r of baseRows) {
    if (r) {
      baseBySymbol.set(r.symbol, Number(r.price));
      baseTsBySymbol.set(r.symbol, r.priceTimestamp);
    }
  }

  const present = symbols.filter(s => latestBySymbol.has(s) && baseBySymbol.has(s) && freeFloatBySymbol.has(s));
  if (present.length === 0) return c.json({ message: "no prices available for baseline and latest" }, 404) as any;

  let baseIndex = 0;
  let currentIndex = 0;
  for (const s of present) {
    const ff = freeFloatBySymbol.get(s) || 0;
    const pBase = baseBySymbol.get(s) as number;
    const pNow = latestBySymbol.get(s) as number;
    baseIndex += ff * pBase;
    currentIndex += ff * pNow;
  }
  if (baseIndex === 0) return c.json({ message: "baseline index is zero" }, 400) as any;

  const indexPrice = 100 * (currentIndex / baseIndex);
  let baseDateIso: string | undefined = undefined;
  if (present.length > 0) {
    let minTs = baseTsBySymbol.get(present[0]) as Date;
    for (const s of present) {
      const ts = baseTsBySymbol.get(s);
      if (ts && ts < minTs) minTs = ts;
    }
    baseDateIso = minTs.toISOString();
  }
  return c.json({ indexPrice, baseDate: baseDateIso, baseIndex, currentIndex, symbols: present, count: present.length }) as any;
});


