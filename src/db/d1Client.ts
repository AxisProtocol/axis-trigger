import type { PrismaLike } from "./types";

// Minimal D1 adapter that emulates the PrismaLike shape used in the app
// It only implements what the app actually calls.

// Minimal D1 typings to satisfy TypeScript without depending on global types
export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[] } | { results?: undefined }>;
  first<T = unknown>(): Promise<T | null>;
};

export type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

export type D1Env = { DB: D1Database };

type PriceRow = {
  id?: number;
  symbol: string;
  source?: string;
  price: string | number;
  priceTimestamp: string | Date;
};

function toIso(input: Date | string | number): string {
  if (input instanceof Date) return input.toISOString();
  if (typeof input === "number") return new Date(input).toISOString();
  // assume already ISO
  return input;
}

export function createD1(env: D1Env): PrismaLike {
  const db = env.DB;

  async function runAll<T = unknown>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = db.prepare(sql).bind(...params);
    const res = await stmt.all<T>();
    return (res.results || []) as T[];
  }

  async function runGet<T = unknown>(sql: string, params: any[] = []): Promise<T | null> {
    const stmt = db.prepare(sql).bind(...params);
    const res = await stmt.first<T>();
    return (res as T) ?? null;
  }

  const price = {
    // Supports where: { symbol: { in: string[] }, priceTimestamp: { gte: Date, lte: Date } }, orderBy: { priceTimestamp: 'asc'|'desc' }
    async findMany(args: any): Promise<PriceRow[]> {
      const symbols: string[] | undefined = args?.where?.symbol?.in;
      const gte: Date | undefined = args?.where?.priceTimestamp?.gte;
      const lte: Date | undefined = args?.where?.priceTimestamp?.lte;
      const order: "asc" | "desc" = args?.orderBy?.priceTimestamp === "desc" ? "desc" : "asc";

      const conditions: string[] = [];
      const params: any[] = [];

      if (symbols && symbols.length > 0) {
        conditions.push(`symbol IN (${symbols.map(() => "?").join(",")})`);
        params.push(...symbols);
      }
      if (gte) {
        conditions.push(`priceTimestamp >= ?`);
        params.push(toIso(gte));
      }
      if (lte) {
        conditions.push(`priceTimestamp <= ?`);
        params.push(toIso(lte));
      }

      const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT id, symbol, source, price, priceTimestamp FROM Price ${whereSql} ORDER BY priceTimestamp ${order}`;
      const rows = await runAll<PriceRow>(sql, params);
      return rows.map(r => ({
        ...r,
        priceTimestamp: new Date(String((r as any).priceTimestamp)),
      }));
    },

    // Supports where: { symbol }, orderBy: { priceTimestamp: 'asc'|'desc' }, select
    async findFirst(args: any): Promise<PriceRow | null> {
      const symbol: string | undefined = args?.where?.symbol;
      const order: "asc" | "desc" = args?.orderBy?.priceTimestamp === "asc" ? "asc" : "desc";
      const select = args?.select as { symbol?: boolean; price?: boolean; priceTimestamp?: boolean } | undefined;

      const cols: string[] = [];
      if (!select || select.symbol) cols.push("symbol");
      if (!select || select.price) cols.push("price");
      if (!select || select.priceTimestamp) cols.push("priceTimestamp");
      if (cols.length === 0) cols.push("symbol", "price", "priceTimestamp");

      const params: any[] = [];
      const whereSql = symbol ? (params.push(symbol), "WHERE symbol = ?") : "";
      const sql = `SELECT ${cols.join(", ")} FROM Price ${whereSql} ORDER BY priceTimestamp ${order} LIMIT 1`;
      const row = await runGet<PriceRow>(sql, params);
      if (!row) return null;
      const mapped: PriceRow = {
        ...row,
        priceTimestamp: new Date(String((row as any).priceTimestamp)),
      };
      return mapped;
    },

    async createMany(args: any): Promise<{ count: number }> {
      const data: Array<PriceRow> = args?.data ?? [];
      if (!data.length) return { count: 0 };
      // Use a single transaction
      await db.batch(
        data.map((row) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO Price (symbol, source, price, priceTimestamp) VALUES (?, ?, ?, ?)`
            )
            .bind(
              row.symbol,
              row.source ?? "unknown",
              typeof row.price === "number" ? row.price : String(row.price),
              toIso(row.priceTimestamp)
            )
        )
      );
      return { count: data.length };
    },
  };

  const client: PrismaLike = {
    price,
    async $queryRawUnsafe<T = unknown>(...args: any[]): Promise<T> {
      // First arg is SQL; subsequent args are params
      const [sql, ...params] = args;
      const rows = await runAll<T>(sql, params);
      return rows as unknown as T;
    },
    async $disconnect() {
      // no-op for D1
    },
  };

  return client;
}


