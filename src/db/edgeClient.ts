import { PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";

export type EdgeEnv = { DATABASE_URL: string };

export function createPrisma(env: EdgeEnv): PrismaClient {
  const client = new PrismaClient({
    datasourceUrl: env.DATABASE_URL,
  }).$extends(withAccelerate());
  return client as unknown as PrismaClient;
}


