import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createPrisma } from "../../db/prismaD1";
import type { PrismaLike } from "../../db/types";
import { performUpdate } from "../../scheduled/update";

const ResponseSchema = z.object({
  ok: z.literal(true),
  famcIndexInserted: z.number().int(),
  assetPricesInserted: z.number().int(),
  runAt: z.string(),
});

const ErrorSchema = z.object({ message: z.string() });

const UpdateBodySchema = z
  .object({
    // YYYY-MM-DD in UTC, clamped to today
    endDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Max 14 days
    days: z.number().int().positive().max(14).optional(),
  })
  .openapi({ title: "UpdateBody" });

const AcceptedSchema = z.object({ ok: z.literal(true), accepted: z.literal(true), runAt: z.string() });

const route = createRoute({
  method: "post",
  path: "/update",
  request: {
    headers: z.object({ "x-update-key": z.string().optional() }).openapi({ title: "UpdateHeaders" }),
    body: {
      content: { "application/json": { schema: UpdateBodySchema } },
    },
  },
  responses: {
    200: { description: "Update executed", content: { "application/json": { schema: ResponseSchema } } },
    202: { description: "Update accepted (running in background)", content: { "application/json": { schema: AcceptedSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
  },
});

// performUpdate moved to services/update.ts

// api route for manual update
export const update = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const headerKey = c.req.header("x-update-key") || "";
  const env = ((c as any).env as Record<string, string | undefined>) || {};
  const expected = env.UPDATE_ACCESS_KEY || process.env.UPDATE_ACCESS_KEY || "";
  if (!expected || headerKey !== expected) {
    return c.json({ message: "unauthorized" }, 401) as any;
  }
  // Run update in background to avoid request CPU time limits
  const db = (env as any).DB;
  if (c.executionCtx && db) {
    c.executionCtx.waitUntil((async () => {
      const prismaBg = createPrisma({ DB: db });
      try {
        const body = await c.req.json().catch(() => ({}));
        await performUpdate(prismaBg as any, env, body);
      } catch (e) {
        console.error("Background update failed", e);
      } finally {
        try { await (prismaBg as any).$disconnect?.(); } catch {}
      }
    })());
    return c.json({ ok: true as const, accepted: true as const, runAt: new Date().toISOString() }, 202) as any;
  }
  // Fallback: run inline if executionCtx or DB binding is not available
  const prisma = (c.get("prisma") as unknown) as PrismaLike as any;
  const body = await c.req.json().catch(() => ({}));
  const result = await performUpdate(prisma, env, body);
  return c.json(result) as any;
});