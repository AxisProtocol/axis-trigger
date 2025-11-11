import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { computeAxisIvwSeries } from "../../utils/axisIVW";

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

const famcSymbol = "FAMC_INDEX";

export const famcindexprice = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const prisma = (c.get("prisma") as unknown) as PrismaLike;
  const to = Math.floor(Date.now() / 1000);
  const from = to - 365 * 86400;
  try {
    const { t, c: series } = await computeAxisIvwSeries(prisma, { from, to, resolution: "D" });
    if (t.length > 0) {
      const baseIndex = series[0];
      const currentIndex = series[series.length - 1];
      const indexPrice = currentIndex;
      const baseDateIso = new Date(t[0] * 1000).toISOString();
      return c.json({ indexPrice, baseDate: baseDateIso, baseIndex, currentIndex, symbols: [], count: 0 }) as any;
    }
  } catch {}
  const [earliest, latest] = await Promise.all([
    (prisma as any).price.findFirst({
      where: { symbol: famcSymbol },
      orderBy: { priceTimestamp: "asc" },
      select: { priceTimestamp: true, price: true },
    }),
    (prisma as any).price.findFirst({
      where: { symbol: famcSymbol },
      orderBy: { priceTimestamp: "desc" },
      select: { priceTimestamp: true, price: true },
    }),
  ]);
  if (!earliest || !latest) return c.json({ message: "no index data available" }, 404) as any;
  const baseIndex = Number(earliest.price);
  const currentIndex = Number(latest.price);
  if (baseIndex === 0) return c.json({ message: "baseline index is zero" }, 400) as any;
  const indexPrice = 100 * (currentIndex / baseIndex);
  const baseDateIso = new Date(earliest.priceTimestamp).toISOString();
  return c.json({ indexPrice, baseDate: baseDateIso, baseIndex, currentIndex, symbols: [famcSymbol], count: 1 }) as any;
});
