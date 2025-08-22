import { type AssetInput, type AssetComputed, type PriceQuote } from "../types";

export function computeFreeFloat(asset: AssetInput): { freeFloat: number; warnings: string[] } {
  const warnings: string[] = [];
  const deduction = asset.foundationHoldings + asset.lockedSupply + asset.heavilyVestedStaked;
  let freeFloat = asset.circulatingSupply - deduction + asset.exchangeCustodyHoldings;
  if (freeFloat < 0) {
    warnings.push("Computed free float is negative; clamping to 0");
    freeFloat = 0;
  }
  return { freeFloat, warnings };
}

export function computeFAMC(asset: AssetInput, quote: PriceQuote): AssetComputed {
  const { freeFloat, warnings } = computeFreeFloat(asset);
  const famc = freeFloat * quote.price;
  return {
    ...asset,
    freeFloat,
    famc,
    warnings,
    price: quote.price,
    priceTimestamp: quote.priceTimestamp,
    priceSource: quote.source
  };
}

