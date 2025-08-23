import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function withPgBouncerParam(url: string | undefined): string | undefined {
  if (!url) return url;
  const hasQuery = url.includes("?");
  const hasParam = /[?&]pgbouncer=/i.test(url);
  if (hasParam) return url;
  return url + (hasQuery ? "&" : "?") + "pgbouncer=true";
}

const datasourceUrl = withPgBouncerParam(process.env.DATABASE_URL);

export const prisma: PrismaClient = global.prisma ?? new PrismaClient({
  datasources: datasourceUrl ? { db: { url: datasourceUrl } } : undefined,
});

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}


