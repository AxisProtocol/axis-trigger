import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import type { PrismaLike } from "./db/types";
import type { KVNamespace } from "@cloudflare/workers-types";
import { api } from "./routes";
import { createD1 } from "./db/d1Client";
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
      // Allow axis-protocol.xyz and all its subdomains (including www.)
      if (/^https?:\/\/([a-z0-9-]+\.)*axis-protocol\.xyz$/i.test(origin)) {
        return origin;
      }
      // Allow localhost for development
      if (/^https?:\/\/localhost(?::\d+)?$/.test(origin)) {
        return origin;
      }
      if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin)) {
        return origin;
      }
      return null;
    },
    allowHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"],
    allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE"],
    exposeHeaders: ["Content-Length", "Content-Type"],
    maxAge: 600,
    credentials: true,
  }))
  .use(prettyJSON())
  // Inject per-request Prisma (D1 adapter) for Workers - MUST be before routes
  .use("*", async (c, next) => {
    const env = ((c as any).env as { DB?: any }) || {};
    console.log("[Middleware] Prisma injection - env.DB available:", !!env.DB);
    
    if (!env.DB) {
      console.error("[Middleware] ERROR: Cloudflare D1 binding DB is not available");
      throw new Error("Cloudflare D1 binding DB is not available in the Worker environment");
    }
    
    try {
      const prisma = createD1({ DB: env.DB });
      console.log("[Middleware] Prisma client created successfully");
      console.log("[Middleware] Prisma has waitlist property:", !!prisma.waitlist);
      (c as any).set("prisma", prisma as unknown as PrismaLike);
      console.log("[Middleware] Prisma set in context");
    } catch (error) {
      console.error("[Middleware] ERROR creating Prisma client:", error);
      throw error;
    }
    
    try {
      await next();
    } finally {
      try { 
        const prisma = c.get("prisma") as any;
        await prisma?.$disconnect?.(); 
      } catch {}
    }
  })
  .get("/docs", swaggerUI({ url: openapi_documentation_route }))
  .route("/", api);

export default {
  fetch: app.fetch,
  scheduled: async (event: any, env: any, ctx: any) => {
    const prisma = createD1({ DB: env.DB });
    try {
      // Check if this is a settlement processing cron (every 1 minute)
      if (event.cron === "*/2 * * * *") {
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