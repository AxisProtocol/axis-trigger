import { schedules } from "@trigger.dev/sdk";
import { loadAppConfig } from "../src/config";

// Declarative scheduled task for Trigger.dev v4
export const famcCron = schedules.task({
  id: "famc-cron",
  cron: (() => {
    const cfg = loadAppConfig();
    // Prefer explicit object to support timezone if provided
    if (cfg.cronTimezone) {
      return { pattern: cfg.cronSchedule, timezone: cfg.cronTimezone } as const;
    }
    return cfg.cronSchedule;
  })(),
  run: async () => {
    const endpoint = process.env.UPDATE_ENDPOINT_URL || "http://localhost:8789/api/update";
    const accessKey = process.env.UPDATE_ACCESS_KEY || "";
    if (!accessKey) {
      throw new Error("Missing UPDATE_ACCESS_KEY environment variable");
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-update-key": accessKey
      },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Update endpoint failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    return data;
  }
});



