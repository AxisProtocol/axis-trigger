import fs from "fs";
import path from "path";
import { type AssetComputed } from "../types";

export interface RunResult {
  runAt: string;
  timezone?: string;
  assets: AssetComputed[];
  totals: {
    famcSum: number;
  };
  index?: {
    indexValue: number;
    calculationBreakdown: {
      assets: Array<{
        symbol: string;
        ratio: number;
        basePrice: number;
        currentPrice: number;
      }>;
      sumOfRatios: number;
    };
  };
}

export function writeRunOutput(result: RunResult): string {
  const outDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date(result.runAt).toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(outDir, `famc-${timestamp}.json`);
  const latestPath = path.join(outDir, "latest.json");
  const content = JSON.stringify(result, null, 2);
  fs.writeFileSync(filePath, content, "utf-8");
  fs.writeFileSync(latestPath, content, "utf-8");
  return filePath;
}

