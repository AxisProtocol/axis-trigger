import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { loadAppConfig } from "../../config";
import { loadAssetsFromConfigFile, loadAssetsFromEnv } from "../../providers/envAssets";
import { fetchCoinGeckoRangeUSD } from "../../providers/prices/coingeckoRange";
import { fetchCoinGeckoPrices } from "../../providers/prices/coingecko";
import { computeFAMC } from "../../utils/famc";
import type { PrismaLike } from "../../db/types";

const ResponseSchema = z.object({
  ok: z.literal(true),
  famcSum: z.number(),
  assets: z.number().int(),
  runAt: z.string(),
});

const ErrorSchema = z.object({ message: z.string() });

const route = createRoute({
  method: "post",
  path: "/update",
  request: {
    headers: z.object({ "x-update-key": z.string().optional() }).openapi({ title: "UpdateHeaders" }),
  },
  responses: {
    200: { description: "Update executed", content: { "application/json": { schema: ResponseSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
  },
});

export const update = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const headerKey = c.req.header("x-update-key") || "";
  const env = ((c as any).env as Record<string, string | undefined>) || {};
  const expected = env.UPDATE_ACCESS_KEY || process.env.UPDATE_ACCESS_KEY || "";
  if (!expected || headerKey !== expected) {
    return c.json({ message: "unauthorized" }, 401) as any;
  }

  const cfg = loadAppConfig();
  const assets = cfg.assetConfigFilePath
    ? loadAssetsFromConfigFile(cfg.assetConfigFilePath)
    : loadAssetsFromEnv();

  const prisma = (c.get("prisma") as unknown) as PrismaLike as any;

  const nowSec = Math.floor(Date.now() / 1000);
  const defaultLookbackDays = Number(process.env.CRON_BACKFILL_DAYS || 7);
  const defaultFromSec = nowSec - defaultLookbackDays * 86400;

  for (const asset of assets) {
    if (!asset.coingeckoId) continue;
    const last = await prisma.price.findFirst?.({
      where: { symbol: asset.symbol, source: "coingecko" },
      orderBy: { priceTimestamp: "desc" },
      select: { priceTimestamp: true }
    });
    const fromUnix = last ? Math.floor(last.priceTimestamp.getTime() / 1000) + 1 : defaultFromSec;
    const toUnix = nowSec;
    if (fromUnix > toUnix) continue;
    const points = await fetchCoinGeckoRangeUSD(asset.coingeckoId, fromUnix, toUnix);
    if (points.length === 0) continue;
    const rows = points.map(p => ({
      symbol: asset.symbol,
      source: "coingecko" as const,
      price: p.price.toString(),
      priceTimestamp: p.timestampIso
    }));
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await prisma.price.createMany?.({ data: chunk, skipDuplicates: true });
    }
  }

  const priceMap = await fetchCoinGeckoPrices(assets);
  const computed = assets.map(asset => {
    const quote = priceMap.get(asset.symbol);
    if (!quote) {
      throw new Error(`Missing price for ${asset.symbol}. Provide coingeckoId.`);
    }
    return computeFAMC(asset, quote);
  });
  const famcSum = computed.reduce((sum, a) => sum + a.famc, 0);
  const runAt = new Date().toISOString();
  return c.json({ ok: true, famcSum, assets: computed.length, runAt }) as any;
});


