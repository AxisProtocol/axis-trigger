import * as Prisma from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import type { PrismaLike } from "./types";

export type EdgeEnv = { DATABASE_URL: string };

export function createPrisma(env: EdgeEnv): PrismaLike {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in the Worker environment");
  }
  // Recommended for Cloudflare Workers: reuse fetch connections across requests
  neonConfig.fetchConnectionCache = true;
  // Use fetch-based querying in edge environments (no WebSocket in Workers)
  neonConfig.poolQueryViaFetch = true;

  const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });
  const PrismaClientCtor = (Prisma as any).PrismaClient as new (args: any) => any;
  const client = new PrismaClientCtor({ adapter });
  return client as unknown as PrismaLike;
}


