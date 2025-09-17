import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { performUpdate } from "../../scheduled/update";

const ResponseSchema = z.object({ ok: z.literal(true), famcIndexInserted: z.number().int(), runAt: z.string() });
const ErrorSchema = z.object({ message: z.string() });

const BodySchema = z
  .object({
    // Accept YYYY-MM-DD or ISO; clamped to today
    endDay: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/).optional(),
    // Max 7 days per call
    days: z.number().int().positive().max(7).optional(),
  })
  .openapi({ title: "UpdateFamcBody" });

const route = createRoute({
  method: "post",
  path: "/update-famc",
  request: {
    headers: z.object({ "x-update-key": z.string().optional() }).openapi({ title: "UpdateHeaders" }),
    body: { content: { "application/json": { schema: BodySchema } } },
  },
  responses: {
    200: { description: "FAMC update executed", content: { "application/json": { schema: ResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
  },
});

export const updateFamc = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const headerKey = c.req.header("x-update-key") || "";
  const env = ((c as any).env as Record<string, string | undefined>) || {};
  const expected = env.UPDATE_ACCESS_KEY || process.env.UPDATE_ACCESS_KEY || "";
  if (!expected || headerKey !== expected) {
    return c.json({ message: "unauthorized" }, 401) as any;
  }
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.days === "number" && body.days > 7) {
    return c.json({ message: "days must be <= 7" }, 400) as any;
  }
  const prisma = (c.get("prisma") as unknown) as PrismaLike as any;
  // Use background when possible to reduce request CPU
  const db = (env as any).DB;
  if (c.executionCtx && db) {
    c.executionCtx.waitUntil((async () => {
      const res = await performUpdate(prisma, env, { ...body, famcOnly: true });
      console.log("/api/update-famc done", res);
    })());
    return c.json({ ok: true as const, famcIndexInserted: 0, runAt: new Date().toISOString() }) as any;
  }
  const res = await performUpdate(prisma, env, { ...body, famcOnly: true });
  return c.json({ ok: true as const, famcIndexInserted: res.famcIndexInserted, runAt: res.runAt }) as any;
});


