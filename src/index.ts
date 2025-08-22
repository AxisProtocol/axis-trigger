import cron from "node-cron";
import { loadAppConfig } from "./config";
import { runComputation } from "./job/runOnce";

async function main() {
  const cfg = loadAppConfig();

  if (cfg.runOnce) {
    const result = await runComputation();
    logSummary(result.totals.famcSum, result.assets.length);
    return;
  }

  const cronOptions: cron.ScheduleOptions = {};
  if (cfg.cronTimezone) cronOptions.timezone = cfg.cronTimezone;

  console.log(`Starting cron with schedule '${cfg.cronSchedule}'${cfg.cronTimezone ? ` TZ=${cfg.cronTimezone}` : ""}`);

  const task = cron.schedule(cfg.cronSchedule, async () => {
    try {
      const result = await runComputation();
      logSummary(result.totals.famcSum, result.assets.length);
    } catch (err) {
      console.error("Job failed:", err);
    }
  }, cronOptions);

  task.start();
}

function logSummary(famcSum: number, numAssets: number) {
  console.log(`[FAMC] assets=${numAssets} total_famc=${famcSum.toFixed(4)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

