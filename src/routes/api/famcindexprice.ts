import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
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
  const { symbols, freeFloatBySymbol } = await loadAssetFreeFloats();
  if (symbols.length === 0) return c.json({ message: "no assets configured" }, 400) as any;
  
  const prisma = (c.get("prisma") as unknown) as PrismaLike;
  // Determine overall time range across configured symbols
  // Align with TV history: use precomputed FAMC_INDEX series stored in prices
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
  const currentIndex = Number(latestIndexRow.price);
  if (baseIndex === 0) return c.json({ message: "baseline index is zero" }, 400) as any;

  const indexPrice = 100 * (currentIndex / baseIndex);
  const baseDateIso = new Date(earliestIndexRow.priceTimestamp).toISOString();
  console.log("[famcindexprice] using precomputed index", { baseDateIso, baseIndex, currentIndex });
  return c.json({ indexPrice, baseDate: baseDateIso, baseIndex, currentIndex, symbols, count: symbols.length }) as any;
});


