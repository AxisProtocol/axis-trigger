import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { PrismaLike } from "../../db/types";
import { loadAppConfig } from "../../config";
import { loadAssetsFromBundledConfig, loadAssetsFromEnv } from "../../providers/envAssets";
import { fetchTopByMarketCap, fetchTrustedExchangeCount, fetchGenesisDate } from "../../providers/coingecko/coingecko";
import { fetchCoinGeckoRangeUSDWithVolumes } from "../../providers/coingecko/coingeckoRange";
import { withKvCache } from "../../utils/kvCache";

// Input for selection parameters
const SelectionQuery = z.object({
  n: z.coerce.number().int().positive().max(50).default(10).openapi({ description: "Target number of constituents" }),
  volumeDays: z.coerce.number().int().positive().max(90).default(30).openapi({ description: "Window for average volume" }),
  minAvgDailyVolumeUsd: z.coerce.number().positive().default(10000000).openapi({ description: "30D average daily volume threshold (USD)" }),
  minTrustedExchanges: z.coerce.number().int().positive().default(3).openapi({ description: "Minimum number of trusted exchanges" }),
  minFreeFloatRatio: z.coerce.number().positive().max(1).default(0.5).openapi({ description: "Free float / circulating supply minimum ratio" }),
  minAgeMonths: z.coerce.number().int().positive().default(12).openapi({ description: "Minimum asset age in months" }),
}).openapi("SelectionQuery");

const SelectionResponse = z.object({
  selected: z.array(z.object({
    symbol: z.string(),
    coingeckoId: z.string().optional(),
    freeFloat: z.number(),
    famc: z.number(),
    avgDailyVolumeUsd: z.number(),
    trustedExchanges: z.number(),
    ageMonths: z.number(),
  })),
  filteredOut: z.array(z.object({ symbol: z.string(), reason: z.string() })),
  params: SelectionQuery,
}).openapi("SelectionResponse");

const route = createRoute({
  method: "get",
  path: "/selection",
  request: { query: SelectionQuery },
  responses: {
    200: { description: "Computed selection set and diagnostic data", content: { "application/json": { schema: SelectionResponse } } },
  },
});

export const selection = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().openapi(route, async (c) => {
  const q = SelectionQuery.parse({
    n: c.req.query("n"),
    volumeDays: c.req.query("volumeDays"),
    minAvgDailyVolumeUsd: c.req.query("minAvgDailyVolumeUsd"),
    minTrustedExchanges: c.req.query("minTrustedExchanges"),
    minFreeFloatRatio: c.req.query("minFreeFloatRatio"),
    minAgeMonths: c.req.query("minAgeMonths"),
  });

  const cfg = loadAppConfig();
  // Start from current configured assets; if empty, fall back to Top N by market cap from CG.
  let baseAssets = cfg.assetConfigFilePath ? loadAssetsFromBundledConfig() : loadAssetsFromEnv();
  if (baseAssets.length === 0) {
    baseAssets = await fetchTopByMarketCap(q.n * 2); // over-fetch to allow filtering
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - q.volumeDays * 86400;

  const out: Array<{ symbol: string; coingeckoId?: string; freeFloat: number; famc: number; avgDailyVolumeUsd: number; trustedExchanges: number; ageMonths: number; }> = [];
  const filteredOut: Array<{ symbol: string; reason: string }> = [];

  for (const a of baseAssets) {
    if (!a.coingeckoId) { filteredOut.push({ symbol: a.symbol, reason: "missing coingeckoId" }); continue; }

    // Compute free float. Note: be careful with exchange custody to avoid double counting.
    const freeFloat = Math.max(0, a.circulatingSupply - (a.foundationHoldings + a.lockedSupply + a.heavilyVestedStaked) + a.exchangeCustodyHoldings);

    // Average daily volume from CG (capped by daily interval alignment)
    const rows = await withKvCache(c, `cg:range:${a.coingeckoId}:${fromSec}:${nowSec}`, 1800, async () => {
      return await fetchCoinGeckoRangeUSDWithVolumes(a.coingeckoId as string, fromSec, nowSec);
    });
    const avgDailyVolumeUsd = rows.length ? rows.reduce((s, r) => s + r.volume, 0) / rows.length : 0;

    // Trusted exchange count
    let trustedExchanges = 0;
    try {
      trustedExchanges = await withKvCache(c, `cg:tickers:${a.coingeckoId}`, 3600, async () => {
        return await fetchTrustedExchangeCount(a.coingeckoId as string);
      });
    } catch {}

    // Age in months from genesis date
    let ageMonths = 0;
    try {
      const g = await withKvCache(c, `cg:genesis:${a.coingeckoId}`, 86400, async () => {
        return await fetchGenesisDate(a.coingeckoId as string);
      });
      if (g) {
        const d = new Date(`${g}T00:00:00.000Z`);
        const months = (nowSec * 1000 - d.getTime()) / (30 * 86400_000);
        ageMonths = Math.floor(months);
      }
    } catch {}

    // Free float ratio
    const ffRatio = a.circulatingSupply > 0 ? freeFloat / a.circulatingSupply : 0;

    // Compute FAMC using last price from the volume window if available
    const last = rows[rows.length - 1];
    const price = last ? last.price : 0;
    const famc = freeFloat * price;

    // Hard filters
    if (avgDailyVolumeUsd < q.minAvgDailyVolumeUsd) { filteredOut.push({ symbol: a.symbol, reason: `avg volume < ${q.minAvgDailyVolumeUsd}` }); continue; }
    if (trustedExchanges < q.minTrustedExchanges) { filteredOut.push({ symbol: a.symbol, reason: `trusted exchanges < ${q.minTrustedExchanges}` }); continue; }
    if (ffRatio < q.minFreeFloatRatio) { filteredOut.push({ symbol: a.symbol, reason: `free float ratio < ${q.minFreeFloatRatio}` }); continue; }
    if (ageMonths < q.minAgeMonths) { filteredOut.push({ symbol: a.symbol, reason: `age < ${q.minAgeMonths}m` }); continue; }

    out.push({ symbol: a.symbol, coingeckoId: a.coingeckoId, freeFloat, famc, avgDailyVolumeUsd, trustedExchanges, ageMonths });
  }

  // Sort by FAMC desc and slice to N
  const selected = out.sort((a, b) => b.famc - a.famc).slice(0, q.n);
  return c.json({ selected, filteredOut, params: q });
});


