import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import type { PrismaLike } from "./db/types";
import { api } from "./routes";
import { createPrisma } from "./db/prismaD1";

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
    origin: "*",
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

export default app;

