import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { computeIndexSeries, SUPPORTED_RESOLUTIONS } from "../../utils/indexSeries";

const QuerySchema = z.object({
  from: z.coerce.number().int().optional().openapi({ description: "Start time (unix seconds)" }),
  to: z.coerce.number().int().optional().openapi({ description: "End time (unix seconds)" }),
  resolution: z.enum(["1","5","15","60","240","D"]).optional().default("60"),
}).openapi("FamcQuery");

const ResponseSchema = z.object({
  t: z.array(z.number().int()),
  value: z.array(z.number()),
  resolution: z.enum(["1","5","15","60","240","D"]),
}).openapi("FamcResponse");

const ErrorSchema = z.object({ message: z.string() }).openapi("ErrorResponse");

const route = createRoute({
  method: "get",
  path: "/famc",
  request: { query: QuerySchema },
  responses: {
    200: { description: "Close-only series", content: { "application/json": { schema: ResponseSchema } } },
    400: { description: "Invalid request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

export const famc = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const from = Number(c.req.query("from")) || Math.floor(new Date(Date.now() - 7 * 86400_000).getTime() / 1000);
  const to = Number(c.req.query("to")) || Math.floor(Date.now() / 1000);
  const resolution = (c.req.query("resolution") as any) || "60";
  if (!SUPPORTED_RESOLUTIONS.includes(resolution)) {
    return c.json({ message: "invalid resolution" }, 400) as any;
  }
  const prisma = (c.get("prisma") as unknown) as PrismaLike;
  const { t, c: values } = await computeIndexSeries(from, to, resolution, prisma);
  return c.json({ t, value: values, resolution }) as any;
});


