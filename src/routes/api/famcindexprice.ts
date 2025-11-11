import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { loadAssetFreeFloats } from "../../utils/indexSeries";
import { computeLatestIvwWeights } from "../../utils/ivw";
import { computeWeightedFAMC, computeLinkedDivisor, computeIndexFromSum } from "../../utils/indexFormula";

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
  const { symbols, freeFloatBySymbol } = await loadAssetFreeFloats();
  if (symbols.length === 0) return c.json({ message: "no assets configured" }, 400) as any;
  
  const prisma = (c.get("prisma") as unknown) as PrismaLike;
  const famcSymbol = "FAMC_INDEX";
  const [earliestIndexRow, latestIndexRow] = await Promise.all([
    (prisma as any).price.findFirst({
      where: { symbol: famcSymbol },
      orderBy: { priceTimestamp: 'asc' },
      select: { priceTimestamp: true, price: true }
    }),
    (prisma as any).price.findFirst({
      where: { symbol: famcSymbol },
      orderBy: { priceTimestamp: 'desc' },
      select: { priceTimestamp: true, price: true }
    })
  ]);

  if (!earliestIndexRow || !latestIndexRow) return c.json({ message: "no index data available" }, 404) as any;

  const baseIndex = Number(earliestIndexRow.price);
  if (baseIndex === 0) return c.json({ message: "baseline index is zero" }, 400) as any;

  // Check if latest index is recent (within 1 day), otherwise compute with weights
  const latestTs = new Date(latestIndexRow.priceTimestamp).getTime();
  const now = Date.now();
  const oneDayMs = 86400 * 1000;
  
  let currentIndex: number;
  if (now - latestTs < oneDayMs) {
    // Use precomputed historical index
    currentIndex = Number(latestIndexRow.price);
  } else {
    // Compute current index with weights for future prices
    const { weights, basket } = await computeLatestIvwWeights(prisma);
    if (basket.length === 0) {
      currentIndex = Number(latestIndexRow.price);
    } else {
      const latestPrices = await Promise.all(
        basket.map(async (sym) => {
          const row = await (prisma as any).price.findFirst({
            where: { symbol: sym },
            orderBy: { priceTimestamp: 'desc' },
            select: { price: true }
          });
          return { sym, price: row ? Number(row.price) : 0 };
        })
      );
      const priceBySymbol = new Map<string, number>();
      for (const { sym, price } of latestPrices) {
        if (price > 0) priceBySymbol.set(sym, price);
      }
      const weightedSum = computeWeightedFAMC(freeFloatBySymbol, priceBySymbol, weights);
      // Use chain-link divisor to maintain continuity with previous index
      const previousIndex = Number(latestIndexRow.price);
      const divisor = computeLinkedDivisor(weightedSum, previousIndex);
      currentIndex = computeIndexFromSum(weightedSum, divisor);
    }
  }

  const indexPrice = 100 * (currentIndex / baseIndex);
  const baseDateIso = new Date(earliestIndexRow.priceTimestamp).toISOString();
  console.log("[famcindexprice] using precomputed index", { baseDateIso, baseIndex, currentIndex });
  return c.json({ indexPrice, baseDate: baseDateIso, baseIndex, currentIndex, symbols, count: symbols.length }) as any;
});


