import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { computeLatestIvwWeights } from "../../utils/ivw";

const ResponseSchema = z.object({
  asOf: z.number().int(),
  basket: z.array(z.string()),
  weights: z.record(z.string(), z.number())
}).openapi("FamcWeightResponseLatest");

const route = createRoute({
  method: "get",
  path: "/famcweight",
  responses: {
    200: { description: "Latest inverse-vol weights (top-K by mcap)", content: { "application/json": { schema: ResponseSchema } } },
  },
});

export const famcweight = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const prisma = (c.get("prisma") as unknown) as PrismaLike;
  const data = await computeLatestIvwWeights(prisma);
  return c.json(data) as any;
});



