// Meta utilities for storing and retrieving small configuration/state values used
// by the index engine. This persists the baseline and divisor for the index so
// that the base date does not shift over time and rebalances are chain-linked.

export const META_KEYS = {
  FAMC_BASE_DATE: "FAMC_BASE_DATE", // ISO date string of the baseline day
  FAMC_BASE_SUM: "FAMC_BASE_SUM",   // Sum S_B at baseline (Σ freeFloat * price)
  FAMC_BASE_INDEX: "FAMC_BASE_INDEX", // e.g. 100
  FAMC_DIVISOR: "FAMC_DIVISOR",     // Current divisor D so that I_t = S_t / D
  FAMC_SET_HASH: "FAMC_SET_HASH",   // Hash of the current constituent set
} as const;

/**
 * Reads a value from Meta table by key. Returns undefined if missing.
 */
export async function getMeta(prisma: any, key: string): Promise<string | undefined> {
  try {
    const rows = await prisma.$queryRawUnsafe("SELECT value FROM Meta WHERE key = ?", key);
    return rows?.[0]?.value as string | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Upserts a value into the Meta table.
 */
export async function setMeta(prisma: any, key: string, value: string): Promise<void> {
  await prisma.$queryRawUnsafe(
    "INSERT INTO Meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value
  );
}


