/**
 * Index Formula Utilities (Documented)
 *
 * Definitions:
 * - Per-asset free-float adjusted value at day t: v_{i,t} = freeFloat_{i,t} × price_{i,t}
 * - Aggregate free-float sum at day t: S_t = Σ_i v_{i,t}
 * - Divisor D ensures continuity: I_t = S_t / D
 *
 * Initialization (baseline B): choose a baseline index (e.g., 100)
 *   D_0 = S_B / I_B
 *
 * Rebalance on day R (constituents/weights change): chain-link so that index is continuous
 *   D_new = S_R^{new} / I_{R-1}
 *   Then for t ≥ R: I_t = S_t^{new} / D_new, yielding I_R = I_{R-1}
 *
 * Weighted FAMC:
 *   v_{i,t}^w = freeFloat_{i,t} × price_{i,t} × weight_i
 *   S_t^w = Σ_i v_{i,t}^w
 */

/**
 * Computes the divisor for the baseline day: D = S_B / I_B
 */
export function computeDivisorForBaseline(sumAtBaseline: number, baselineIndex: number): number {
  if (!(sumAtBaseline > 0) || !(baselineIndex > 0)) throw new Error("baseline inputs must be positive");
  return sumAtBaseline / baselineIndex;
}

/**
 * Chain-link divisor at rebalance: D_new = S_R^{new} / I_{R-1}
 */
export function computeLinkedDivisor(sumAtRebalanceNewSet: number, previousIndex: number): number {
  if (!(sumAtRebalanceNewSet > 0) || !(previousIndex > 0)) throw new Error("rebalance inputs must be positive");
  return sumAtRebalanceNewSet / previousIndex;
}

/**
 * Computes index level from a daily aggregate sum and the current divisor: I_t = S_t / D
 */
export function computeIndexFromSum(dailySum: number, divisor: number): number {
  if (!(divisor > 0)) throw new Error("divisor must be positive");
  return dailySum / divisor;
}

/**
 * Computes inverse-volatility weights from price series
 * Formula: w_i = (1/σ_i) / Σ_j (1/σ_j)
 * where σ_i is the standard deviation of log returns over L days
 */
export function computeInverseVolWeights(
  seriesBySymbol: Map<string, Array<{ t: number; p: number }>>,
  basket: string[],
  asOf: number,
  L: number
): Record<string, number> {
  const start = asOf - L * 86400;
  const vols: Array<{ sym: string; s: number }> = [];
  
  for (const sym of basket) {
    const arr = (seriesBySymbol.get(sym) || []).filter(x => x.t > start && x.t <= asOf);
    if (arr.length < 11) continue;
    
    const rets: number[] = [];
    for (let i = 1; i < arr.length; i++) {
      const r = Math.log(arr[i].p / arr[i - 1].p);
      if (Number.isFinite(r)) rets.push(r);
    }
    if (rets.length < 10) continue;
    
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const varx = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rets.length;
    const s = Math.sqrt(varx);
    if (s > 0) vols.push({ sym, s });
  }
  
  if (!vols.length) {
    const w = 1 / basket.length;
    return Object.fromEntries(basket.map(s => [s, w]));
  }
  
  const inv = vols.map(v => ({ sym: v.sym, w: 1 / Math.max(v.s, 1e-12) }));
  const sumInv = inv.reduce((a, b) => a + b.w, 0);
  return Object.fromEntries(inv.map(v => [v.sym, v.w / sumInv]));
}

/**
 * Computes weighted FAMC: Σ_i (freeFloat_i × price_i × weight_i)
 */
export function computeWeightedFAMC(
  freeFloatBySymbol: Map<string, number>,
  priceBySymbol: Map<string, number>,
  weights: Record<string, number>
): number {
  let sum = 0;
  for (const [sym, weight] of Object.entries(weights)) {
    const ff = freeFloatBySymbol.get(sym) || 0;
    const p = priceBySymbol.get(sym) || 0;
    sum += ff * p * weight;
  }
  return sum;
}


