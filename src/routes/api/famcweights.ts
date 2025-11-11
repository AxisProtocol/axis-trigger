import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { withKvCache } from "../../utils/kvCache";
import { SUPPORTED_RESOLUTIONS } from "../../utils/indexSeries";
import { computeAxisIvwWeights } from "../../utils/axisIVW";

const QuerySchema = z.object({
  from: z.coerce.number().int().optional().openapi({ description: "Start time (unix seconds)" }),
  to: z.coerce.number().int().optional().openapi({ description: "End time (unix seconds)" }),
  resolution: z.enum(["1","5","15","60","240","D"]).optional().default("D"),
}).openapi("FamcWeightsQuery");

const WeightMapSchema = z.record(z.string(), z.number());
const RebalanceItemSchema = z.object({
  t: z.number().int(),
  basket: z.array(z.string()),
  weights: WeightMapSchema,
});

const ResponseSchema = z.object({
  resolution: z.enum(["1","5","15","60","240","D"]),
  rebalances: z.array(RebalanceItemSchema),
  latest: RebalanceItemSchema.nullable(),
}).openapi("FamcWeightsResponse");

const ErrorSchema = z.object({ message: z.string() }).openapi("ErrorResponse");

const route = createRoute({
  method: "get",
  path: "/famcweights",
  request: { query: QuerySchema },
  responses: {
    200: { description: "IVW weights at each rebalance and latest snapshot", content: { "application/json": { schema: ResponseSchema } } },
    400: { description: "Invalid request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

export const famcweights = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const to = Number(c.req.query("to")) || Math.floor(Date.now() / 1000);
  const from = Number(c.req.query("from")) || to - 365 * 86400;
  const resolution = (c.req.query("resolution") as any) || "D";
  if (!SUPPORTED_RESOLUTIONS.includes(resolution)) {
    return c.json({ message: "invalid resolution" }, 400) as any;
  }
  const prisma = (c.get("prisma") as unknown) as PrismaLike;
  const cacheKey = `api:famcweights:${resolution}:${from}:${to}`;
  const data = await withKvCache(c, cacheKey, 60, async () =>
    computeAxisIvwWeights(prisma, { from, to, resolution })
  );
  return c.json(data) as any;
});
