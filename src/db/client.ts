// For Node scripts (e.g., backfill), keep using Prisma if available,
// but default to a NOOP to avoid runtime import errors when not installed.
let prisma: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require("@prisma/client");
  prisma = new PrismaClient();
} catch {
  prisma = {
    price: {
      createMany: async () => ({ count: 0 })
    },
    $disconnect: async () => undefined,
  };
}

export { prisma };


