import type { PrismaLike } from "../db/types";
import { loadAssetsFromBundledConfig, loadAssetsFromEnv } from "../providers/envAssets";
import { computeFreeFloat } from "./famc";
import { computeInverseVolWeights } from "./indexFormula";

export interface LatestIvwParams {
  L?: number;
  K?: number;
  histBufferDays?: number;
  nowSec?: number;
}

export interface LatestIvwWeights {
  asOf: number;
  basket: string[];
  weights: Record<string, number>;
}

export async function computeLatestIvwWeights(
  prisma: PrismaLike,
  { L = 90, K = 5, histBufferDays = 30, nowSec }: LatestIvwParams = {}
): Promise<LatestIvwWeights> {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const from = now - (L + histBufferDays) * 86400;

  const env = loadAssetsFromEnv();
  const bundled = loadAssetsFromBundledConfig();
  const bySym = new Map<string, any>();
  for (const a of bundled) bySym.set(a.symbol, a);
  for (const a of env) bySym.set(a.symbol, a);
  const symbols = Array.from(bySym.values()).map(a => a.symbol);
  if (!symbols.length) return { asOf: now, basket: [], weights: {} };

  const cfgFreeFloat: Record<string, number> = {};
  for (const a of bySym.values()) cfgFreeFloat[a.symbol] = computeFreeFloat(a).freeFloat;

  // SQL: fetch latest price and supply, then pick top-K by mcap in TypeScript
  const latestRows = await fetchLatestSupplyAndPrice(prisma, symbols, now);
  const basket = pickTopKByMcap(latestRows, cfgFreeFloat, K);
  if (basket.length === 0) return { asOf: now, basket, weights: {} };

  const histRows = await fetchHistoryGrouped(prisma, basket, from, now);
  const seriesBySymbol = new Map<string, Array<{ t: number; p: number }>>();
  for (const r of histRows) {
    const p = Number(r.price);
    if (p > 0) {
      const t = Math.floor((typeof r.ts === "string" ? new Date(r.ts) : r.ts).getTime() / 1000);
      const arr = seriesBySymbol.get(r.symbol) || [];
      if (!seriesBySymbol.has(r.symbol)) seriesBySymbol.set(r.symbol, arr);
      arr.push({ t, p });
    }
  }

  const weights = computeInverseVolWeights(seriesBySymbol, basket, now, L);
  return { asOf: now, basket, weights };
}

async function fetchLatestSupplyAndPrice(
  prisma: PrismaLike,
  symbols: string[],
  now: number
): Promise<Array<{ symbol: string; supply: number | null; price: number | null }>> {
  if (!symbols.length) return [];
  const placeholders = symbols.map(() => "(?)").join(",");
  const sql = `
    WITH sym(symbol) AS (VALUES ${placeholders})
    SELECT s.symbol,
           COALESCE(a.circulatingSupply, 0) AS supply,
           (SELECT p.price FROM Price p 
            WHERE p.symbol = s.symbol AND p.priceTimestamp <= ? 
            ORDER BY p.priceTimestamp DESC LIMIT 1) AS price
    FROM sym s
    LEFT JOIN Asset a ON a.symbol = s.symbol
  `;
  const rows = await (prisma as any).$queryRawUnsafe(
    sql,
    ...symbols,
    new Date(now * 1000).toISOString()
  ) as Array<{ symbol: string; supply: number | null; price: number | null }>;
  return rows;
}

function pickTopKByMcap(
  rows: Array<{ symbol: string; supply: number | null; price: number | null }>,
  cfgFreeFloat: Record<string, number>,
  K: number
): string[] {
  const arr = rows
    .map(r => {
      const p = Number(r.price ?? 0);
      const s = Number(r.supply ?? 0);
      const supply = s > 0 ? s : (cfgFreeFloat[r.symbol] ?? 0);
      const cap = p > 0 && supply > 0 ? supply * p : NaN;
      return { sym: r.symbol, cap };
    })
    .filter(x => Number.isFinite(x.cap)) as Array<{ sym: string; cap: number }>;
  arr.sort((a, b) => b.cap - a.cap);
  return arr.slice(0, K).map(x => x.sym);
}

async function fetchHistoryGrouped(
  prisma: PrismaLike,
  basket: string[],
  from: number,
  to: number
): Promise<Array<{ symbol: string; ts: Date | string; price: number | string }>> {
  if (!basket.length) return [];
  const rows = await prisma.price.findMany({
    where: { symbol: { in: basket }, priceTimestamp: { gte: new Date(from * 1000), lte: new Date(to * 1000) } },
    orderBy: [{ symbol: "asc" }, { priceTimestamp: "asc" }],
    select: { symbol: true, price: true, priceTimestamp: true }
  });
  return rows.map(r => ({ symbol: r.symbol, ts: r.priceTimestamp as Date, price: r.price }));
}



