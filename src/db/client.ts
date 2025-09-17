// For Node scripts (e.g., backfill), keep using Prisma if available,
// but default to a NOOP to avoid runtime import errors when not installed.
let prisma: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require("@prisma/client");
  if (process.env.DATABASE_URL) {
    prisma = new PrismaClient();
  } else {
    throw new Error("DATABASE_URL not set");
  }
} catch {
  // Fallback mock for environments without DATABASE_URL (D1 mode).
  prisma = {
    price: {
      createMany: async () => {
        throw new Error(
          "Prisma DATABASE_URL is not set. For D1, run the Worker and POST /api/update to insert data."
        );
      },
    },
    $disconnect: async () => undefined,
  };
}

export { prisma };


