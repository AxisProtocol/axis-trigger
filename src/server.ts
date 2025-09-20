import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import type { PrismaLike } from "./db/types";
import type { KVNamespace } from "@cloudflare/workers-types";
import { api } from "./routes";
import { createPrisma } from "./db/prismaD1";
import { performUpdate } from "./scheduled/update";
import { processPendingSettlements } from "./scheduled/settlementProcessor";

interface CloudflareBindings {
  SETTLEMENTS_KV: KVNamespace;
}

const openapi_documentation_route = "/openapi.json";
const app = new OpenAPIHono<{ Variables: { prisma: PrismaLike }, Bindings: CloudflareBindings }>().doc(openapi_documentation_route, {
  openapi: "3.1.0",
  info: {
    version: "1.0.0",
    title: "worker",
  },
});

app
  .use("*", cors({
    origin: (origin: string) => {
      if (!origin) return null;
      if (/^https?:\/\/([a-z0-9-]+\.)*axis-protocol\.xyz$/i.test(origin)) return origin; // allow subdomains
      if (/^https?:\/\/localhost(?::\d+)?$/.test(origin)) return origin;
      if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin)) return origin;
      return null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }))
  .get("/docs", swaggerUI({ url: openapi_documentation_route }))
  .use(prettyJSON())
  // Inject per-request Prisma (D1 adapter) for Workers
  .use("/*", async (c, next) => {
    const env = ((c as any).env as { DB?: any }) || {};
    if (!env.DB) {
      throw new Error("Cloudflare D1 binding DB is not available in the Worker environment");
    }
    const prisma = createPrisma({ DB: env.DB });
    (c as any).set("prisma", prisma as unknown as PrismaLike);
    try {
      await next();
    } finally {
      try { await (prisma as any).$disconnect?.(); } catch {}
    }
  })
  .route("/", api);

export default {
  fetch: app.fetch,
  scheduled: async (event: any, env: any, ctx: any) => {
    const prisma = createPrisma({ DB: env.DB });
    try {
      // Check if this is a settlement processing cron (every 1 minute)
      if (event.cron === "*/1 * * * *") {
        console.log("Processing pending settlements...");

        const context = {
          env,
          get: (key: string) => {
            if (key === "prisma") return prisma;
            return null;
          }
        };
        await processPendingSettlements(context);
      } else {
        // For other scheduled runs, process the last 3 days
        const result = await performUpdate(prisma as any, env as any, { days: 3 });
        console.log("Scheduled update result:", result);
      }
    } finally {
      try { await (prisma as any).$disconnect?.(); } catch {}
    }
  }
} as any;