import { z } from "zod";

export const assetInputSchema = z.object({
  symbol: z.string().min(1),
  coingeckoId: z.string().min(1).optional(),
  binanceSymbol: z.string().min(1).optional(),
  circulatingSupply: z.number().nonnegative(),
  foundationHoldings: z.number().nonnegative().default(0),
  lockedSupply: z.number().nonnegative().default(0),
  heavilyVestedStaked: z.number().nonnegative().default(0),
  exchangeCustodyHoldings: z.number().nonnegative().default(0)
});

export type AssetInput = z.infer<typeof assetInputSchema>;

export interface PriceQuote {
  symbol: string; // ticker symbol
  price: number; // in USD
  source: "coingecko" | "binance";
  priceTimestamp: string; // ISO string
}

export interface AssetComputed extends AssetInput {
  freeFloat: number;
  famc: number;
  warnings: string[];
  price: number;
  priceTimestamp: string;
  priceSource: PriceQuote["source"];
}

export const assetConfigFileSchema = z.object({
  assets: z.array(assetInputSchema).min(1)
});

export type AssetConfigFile = z.infer<typeof assetConfigFileSchema>;

export const appConfigSchema = z.object({
  cronSchedule: z.string().min(1).default("0 * * * *"),
  cronTimezone: z.string().min(1).optional(),
  runOnce: z.boolean().default(false),
  assetConfigFilePath: z.string().optional()
});

export type AppConfig = z.infer<typeof appConfigSchema>;

