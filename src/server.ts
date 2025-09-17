import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import type { PrismaLike } from "./db/types";
import { api } from "./routes";
import { createPrisma } from "./db/prismaD1";
import { performUpdate } from "./scheduled/update";

const openapi_documentation_route = "/openapi.json";
const app = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>().doc(openapi_documentation_route, {
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
      if (origin === "https://axis-protocol.xyz" || origin === "http://axis-protocol.xyz") return origin;
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
      // For scheduled runs, always process the last 3 days
      const result = await performUpdate(prisma as any, env as any, { days: 3 });
      console.log("Scheduled update result:", result);
    } finally {
      try { await (prisma as any).$disconnect?.(); } catch {}
    }
  }
} as any;

