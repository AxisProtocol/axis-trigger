import { createBaseApp } from "./app";
import { registerIndexRoutes } from "./routes/indexRoutes";
import { createPrisma } from "./db/edgeClient";
import type { PrismaLike } from "./db/types";

// Create the base app and register DB-backed routes for full functionality in production
const app = createBaseApp({ includeDbRoutesInDocs: true });
// Middleware to inject per-request Prisma into context
app.use("/*", async (c, next) => {
  const env = ((c as any).env as { DATABASE_URL?: string }) || {};
  const prisma = createPrisma({ DATABASE_URL: String(env.DATABASE_URL) });
  (c as any).set("prisma", prisma as unknown as PrismaLike);
  try {
    await next();
  } finally {
    try { await (prisma as any).$disconnect?.(); } catch {}
  }
});

registerIndexRoutes(app);

export default {
  async fetch(request: Request, env: { DATABASE_URL: string }, ctx?: any) {
    return app.fetch(request, env as any, ctx as any);
  },
};


