import type { PrismaLike } from "../db/types";
import { loadAssetsFromBundledConfig, loadAssetsFromEnv } from "../providers/envAssets";

export type Reso = "1" | "5" | "15" | "60" | "240" | "D";

export interface AxisIvwParams {
  from: number;
  to: number;
  resolution: Reso;
  L?: number;
  K?: number;
}

export interface AxisIvwSeries {
  t: number[];
  c: number[];
}

export async function computeAxisIvwSeries(
  prisma: PrismaLike,
  { from, to, resolution, L = 90, K = 5 }: AxisIvwParams
): Promise<AxisIvwSeries> {
  const env = loadAssetsFromEnv();
  const bundled = loadAssetsFromBundledConfig();
  const bySym = new Map<string, any>();
  for (const a of bundled) bySym.set(a.symbol, a);
  for (const a of env) bySym.set(a.symbol, a);
  const symbols = Array.from(bySym.values()).map((a) => a.symbol);
  if (!symbols.length) return { t: [], c: [] };

  const placeholders = symbols.map(() => "?").join(",");
  const fromIso = new Date(from * 1000).toISOString();
  const toIso = new Date(to * 1000).toISOString();

  const rows = (await (prisma as any).$queryRawUnsafe(
    `
    SELECT symbol, priceTimestamp AS ts, price
    FROM Price
    WHERE symbol IN (${placeholders})
      AND priceTimestamp >= ?
      AND priceTimestamp <= ?
    ORDER BY priceTimestamp ASC
  `,
    ...symbols,
    fromIso,
    toIso
  )) as Array<{ symbol: string; ts: string | Date; price: number | string }>;

  const series = new Map<string, Array<{ t: number; p: number }>>();
  for (const s of symbols) series.set(s, []);
  for (const r of rows) {
    const pNum = Number(r.price);
    if (!(pNum > 0)) continue;
    const ts = typeof r.ts === "string" ? new Date(r.ts) : (r.ts as Date);
    const tsec = Math.floor(ts.getTime() / 1000);
    series.get(r.symbol)!.push({ t: tsec, p: pNum });
  }

  const tGrid = mergeAndSortUniqueT(series);
  if (!tGrid.length) return { t: [], c: [] };

  const assetPlaceholders = symbols.map(() => "?").join(",");
  const assetRows = (await (prisma as any).$queryRawUnsafe(
    `
    SELECT symbol, circulatingSupply
    FROM Asset
    WHERE symbol IN (${assetPlaceholders})
  `,
    ...symbols
  )) as Array<{ symbol: string; circulatingSupply: number | string | null }>;

  const supply: Record<string, number> = {};
  for (const r of assetRows) supply[r.symbol] = Number(r.circulatingSupply ?? 0);

  const rbTargets = quarterlyTargetsBetween(from, to);
  const rbDates = snapTargetsToSeries(rbTargets, tGrid);

  let idx = 100;
  const c: number[] = [];
  let w: Record<string, number> = {};
  let k = 0;

  for (let i = 0; i < tGrid.length; i++) {
    const t = tGrid[i];
    if (k < rbDates.length && t >= rbDates[k]) {
      const basket = pickTopKByMcap(symbols, series, supply, t, K);
      w = inverseVolWeights(series, basket, t, L);
      k++;
    }
    const pr = portfolioReturnAt(series, w, i, tGrid);
    idx *= 1 + pr;
    c.push(idx);
  }

  return { t: tGrid, c };
}

function mergeAndSortUniqueT(map: Map<string, Array<{ t: number; p: number }>>) {
  const S = new Set<number>();
  for (const arr of map.values()) for (const x of arr) S.add(x.t);
  return Array.from(S).sort((a, b) => a - b);
}

function quarterlyTargetsBetween(from: number, to: number) {
  const out: number[] = [];
  const d = new Date(from * 1000);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  while (Math.floor(d.getTime() / 1000) <= to) {
    const m = d.getUTCMonth();
    if (m === 0 || m === 3 || m === 6 || m === 9) out.push(Math.floor(d.getTime() / 1000));
    d.setUTCMonth(m + 1);
  }
  return out;
}

function snapTargetsToSeries(targets: number[], grid: number[]) {
  const out: number[] = [];
  let j = 0;
  for (const tg of targets) {
    while (j < grid.length && grid[j] < tg) j++;
    if (j < grid.length) out.push(grid[j]);
  }
  return out;
}

function latestAtOrBefore(arr: Array<{ t: number; p: number }>, t: number) {
  let best: { t: number; p: number } | undefined;
  for (const x of arr) {
    if (x.t <= t) best = x;
    else break;
  }
  return best;
}

function sliceByDays(arr: Array<{ t: number; p: number }>, end: number, L: number) {
  const start = end - L * 86400;
  return arr.filter((x) => x.t > start && x.t <= end);
}

function logReturns(arr: Array<{ t: number; p: number }>) {
  const out: number[] = [];
  for (let i = 1; i < arr.length; i++) {
    const r = Math.log(arr[i].p / arr[i - 1].p);
    if (Number.isFinite(r)) out.push(r);
  }
  return out;
}

function stddev(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
  return Math.sqrt(v);
}

function pickTopKByMcap(
  symbols: string[],
  series: Map<string, Array<{ t: number; p: number }>>,
  supply: Record<string, number>,
  t: number,
  K: number
) {
  const arr = symbols
    .map((sym) => {
      const p = latestAtOrBefore(series.get(sym)!, t)?.p ?? NaN;
      const s = supply[sym] ?? 0;
      return { sym, cap: s > 0 && p > 0 ? s * p : NaN };
    })
    .filter((x) => Number.isFinite(x.cap)) as Array<{ sym: string; cap: number }>;
  arr.sort((a, b) => b.cap - a.cap);
  return arr.slice(0, K).map((x) => x.sym);
}

function inverseVolWeights(
  series: Map<string, Array<{ t: number; p: number }>>,
  basket: string[],
  t: number,
  L: number
) {
  const vols: Array<{ sym: string; s: number }> = [];
  for (const sym of basket) {
    const win = sliceByDays(series.get(sym)!, t, L);
    const rets = logReturns(win);
    if (rets.length < 10) continue;
    const s = stddev(rets);
    if (!(s > 0)) continue;
    vols.push({ sym, s });
  }
  if (!vols.length) {
    const w = 1 / Math.max(1, basket.length);
    return Object.fromEntries(basket.map((s) => [s, w]));
  }
  const inv = vols.map((v) => ({ sym: v.sym, w: 1 / Math.max(v.s, 1e-12) }));
  const sum = inv.reduce((a, b) => a + b.w, 0);
  return Object.fromEntries(inv.map((v) => [v.sym, v.w / sum]));
}

function portfolioReturnAt(
  series: Map<string, Array<{ t: number; p: number }>>,
  w: Record<string, number>,
  i: number,
  grid: number[]
) {
  if (i === 0) return 0;
  let r = 0;
  const t0 = grid[i - 1];
  const t1 = grid[i];
  for (const [sym, wi] of Object.entries(w)) {
    const s = series.get(sym)!;
    const p0 = latestAtOrBefore(s, t0)?.p;
    const p1 = latestAtOrBefore(s, t1)?.p;
    if (p0 && p1) r += wi * (p1 / p0 - 1);
  }
  return r;
}
