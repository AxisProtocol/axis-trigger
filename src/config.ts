import dotenv from "dotenv";
import { appConfigSchema, type AppConfig } from "./types";

dotenv.config();

export function loadAppConfig(): AppConfig {
  const parsed = appConfigSchema.safeParse({
    cronSchedule: process.env.CRON_SCHEDULE,
    cronTimezone: process.env.CRON_TZ,
    runOnce: parseBoolean(process.env.RUN_ONCE),
    assetConfigFilePath: process.env.ASSET_CONFIG_FILE
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`Invalid configuration: ${issues}`);
  }

  return parsed.data;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return undefined;
}

