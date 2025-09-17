import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createPrisma } from "../../db/prismaD1";
import type { PrismaLike } from "../../db/types";
import { performUpdate } from "../../scheduled/update";

const BatchRequestSchema = z
  .object({
    // YYYY-MM-DD UTC, clamped to today
    endDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // 1..90 requested; we will chunk into 7-day windows, each sub-call capped to 7
    days: z.number().int().positive().max(90),
    // optional chunk size override, default 7, max 7
    chunkDays: z.number().int().positive().max(7).optional(),
  })
  .openapi({ title: "UpdateBatchBody" });

const BatchAcceptedSchema = z.object({ ok: z.literal(true), accepted: z.literal(true), chunks: z.number().int(), runAt: z.string() });
const BatchResultSchema = z.object({ ok: z.literal(true), chunks: z.number().int(), totalFamcIndexInserted: z.number().int(), totalAssetPricesInserted: z.number().int(), runAt: z.string() });
const ErrorSchema = z.object({ message: z.string() });

const route = createRoute({
  method: "post",
  path: "/update-batch",
  request: {
    headers: z.object({ "x-update-key": z.string().optional() }).openapi({ title: "UpdateHeaders" }),
    body: { content: { "application/json": { schema: BatchRequestSchema } } },
  },
  responses: {
    200: { description: "Batch update executed", content: { "application/json": { schema: BatchResultSchema } } },
    202: { description: "Batch accepted (running in background)", content: { "application/json": { schema: BatchAcceptedSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
  },
});

export const updateBatch = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const headerKey = c.req.header("x-update-key") || "";
  const env = ((c as any).env as Record<string, string | undefined>) || {};
  const expected = env.UPDATE_ACCESS_KEY || process.env.UPDATE_ACCESS_KEY || "";
  if (!expected || headerKey !== expected) {
    return c.json({ message: "unauthorized" }, 401) as any;
  }

  const body = await c.req.json().catch(() => ({} as any));
  const endDay: string = body.endDay;
  const days: number = body.days;
  const chunkDays: number = Math.max(1, Math.min(7, body.chunkDays || 7));

  // Clamp total days to 90 for safety; actual /update caps to 14 but we split into <=7 chunks
  const totalDays = Math.min(90, Math.max(1, days));
  const chunks: Array<{ endDay: string; days: number }> = [];

  // Build chunks backward from endDay in windows of chunkDays
  const todayUtc = new Date();
  const todayStr = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate())).toISOString().slice(0,10);
  let cursorEnd = endDay > todayStr ? todayStr : endDay;
  let remaining = totalDays;
  while (remaining > 0) {
    const span = Math.min(chunkDays, remaining);
    chunks.push({ endDay: cursorEnd, days: span });
    // move cursorEnd back by span days
    const endDate = new Date(`${cursorEnd}T00:00:00.000Z`);
    const prevEnd = new Date(endDate.getTime() - span * 86400 * 1000);
    const prevEndStr = new Date(Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), prevEnd.getUTCDate())).toISOString().slice(0,10);
    cursorEnd = prevEndStr;
    remaining -= span;
  }

  console.log("/api/update-batch plan", { chunks });

  // Prefer background execution to avoid request CPU limits
  const db = (env as any).DB;
  if (c.executionCtx && db) {
    c.executionCtx.waitUntil((async () => {
      const prismaBg = createPrisma({ DB: db });
      try {
        let totalFamc = 0;
        let totalAsset = 0;
        for (const ch of chunks) {
          const res = await performUpdate(prismaBg as any, env, { endDay: ch.endDay, days: ch.days });
          totalFamc += res.famcIndexInserted;
          totalAsset += res.assetPricesInserted;
          console.log("/api/update-batch chunk done", { ch, res });
        }
        console.log("/api/update-batch done", { chunks: chunks.length, totalFamc, totalAsset });
      } catch (e) {
        console.error("/api/update-batch failed", e);
      } finally {
        try { await (prismaBg as any).$disconnect?.(); } catch {}
      }
    })());
    return c.json({ ok: true as const, accepted: true as const, chunks: chunks.length, runAt: new Date().toISOString() }, 202) as any;
  }

  // Inline fallback: run sequentially
  const prisma = (c.get("prisma") as unknown) as PrismaLike as any;
  let totalFamc = 0;
  let totalAsset = 0;
  for (const ch of chunks) {
    const res = await performUpdate(prisma, env, { endDay: ch.endDay, days: ch.days });
    totalFamc += res.famcIndexInserted;
    totalAsset += res.assetPricesInserted;
    console.log("/api/update-batch chunk done (inline)", { ch, res });
  }
  return c.json({ ok: true as const, chunks: chunks.length, totalFamcIndexInserted: totalFamc, totalAssetPricesInserted: totalAsset, runAt: new Date().toISOString() }) as any;
});


