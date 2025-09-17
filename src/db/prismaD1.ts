import type { PrismaLike } from "./types";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

// Minimal D1 typings (local) in case global types are absent
export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[] } | { results?: undefined }>;
  first<T = unknown>(): Promise<T | null>;
};

export type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

export type EdgeEnv = { DB: D1Database };

export function createPrisma(env: EdgeEnv): PrismaLike {
  if (!env.DB) throw new Error("D1 binding DB is missing");
  const adapter = new PrismaD1(env.DB as any);
  const client = new PrismaClient({ adapter }) as unknown as PrismaLike;
  return client;
}


