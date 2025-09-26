import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { loadAssetFreeFloats } from "../../utils/indexSeries";

const ResponseSchema = z.object({
  symbols: z.array(z.string()),
  count: z.number().int(),
});

const route = createRoute({
  method: "get",
  path: "/symbols",
  responses: {
    200: { description: "Current symbols from merged config (env overrides bundled)", content: { "application/json": { schema: ResponseSchema } } },
    400: { description: "No assets configured", content: { "application/json": { schema: z.object({ message: z.string() }) } } },
  },
});

export const symbolsApi = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const { symbols } = await loadAssetFreeFloats();
  if (symbols.length === 0) return c.json({ message: "no assets configured" }, 400) as any;
  return c.json({ symbols, count: symbols.length }) as any;
});