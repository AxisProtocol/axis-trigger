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


