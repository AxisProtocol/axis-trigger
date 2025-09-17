import dotenv from "dotenv";
dotenv.config();

// Simple backfill script that calls the local /api/update endpoint in 7-day chunks

function toUtcDateString(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

function parseStartDay(input?: string): string {
  if (!input) throw new Error("Missing START_DAY. Format: YYYY-MM-DD");
  const isoPrefix = input.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoPrefix)) throw new Error("Invalid START_DAY. Expected YYYY-MM-DD");
  return isoPrefix;
}

function daysBetweenInclusive(startDay: string, endDay: string): number {
  const start = new Date(`${startDay}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDay}T00:00:00.000Z`).getTime();
  if (end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const START_DAY = parseStartDay(process.env.START_DAY || process.argv[2]);
  const todayStr = toUtcDateString(new Date());
  const BASE_URL = process.env.BASE_URL || "http://localhost:8788"; // wrangler dev default
  const API_PATH = process.env.API_PATH || "/api/update"; // default to full update
  const UPDATE_KEY = process.env.UPDATE_ACCESS_KEY || process.env.X_UPDATE_KEY || process.env.UPDATE_KEY || "";
  if (!UPDATE_KEY) throw new Error("Missing UPDATE_ACCESS_KEY in env");

  const totalDays = daysBetweenInclusive(START_DAY, todayStr);
  if (totalDays <= 0) {
    // eslint-disable-next-line no-console
    console.log("Nothing to backfill: start is after today");
    return;
  }

  // Build 7-day chunks FORWARD from START_DAY to today
  let remaining = totalDays;
  let cursorStart = START_DAY;
  const chunkSize = 7;
  let chunkIndex = 0;
  // eslint-disable-next-line no-console
  console.log("Backfill plan", { startDay: START_DAY, today: todayStr, totalDays, chunkSize });

  while (remaining > 0) {
    const span = Math.min(chunkSize, remaining);
    // endDay is the last day of this chunk window, moving forward
    const startDate = new Date(`${cursorStart}T00:00:00.000Z`);
    const endDate = new Date(startDate.getTime() + (span - 1) * 86400000);
    const endDay = toUtcDateString(endDate);
    const body = { endDay, days: span } as any;
    // eslint-disable-next-line no-console
    console.log("Calling backfill", { path: API_PATH, chunkIndex, body });
    const res = await fetch(`${BASE_URL}${API_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-update-key": UPDATE_KEY },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    // eslint-disable-next-line no-console
    console.log("backfill response", { status: res.status, body: text.slice(0, 500) });
    if (!res.ok) {
      throw new Error(`Update failed for chunk ${chunkIndex}: ${res.status} ${res.statusText}`);
    }

    // Move cursorStart forward by span days
    const nextStart = new Date(new Date(`${cursorStart}T00:00:00.000Z`).getTime() + span * 86400000);
    cursorStart = toUtcDateString(nextStart);
    remaining -= span;
    chunkIndex++;

    // small delay to avoid upstream rate limits
    const delayMs = Number(process.env.BACKFILL_DELAY_MS || 500);
    if (remaining > 0 && delayMs > 0) await sleep(delayMs);
  }

  // eslint-disable-next-line no-console
  console.log("Backfill completed", { chunks: chunkIndex });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


