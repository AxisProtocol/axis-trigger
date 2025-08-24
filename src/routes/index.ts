import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { swaggerUI } from "@hono/swagger-ui";
import { prettyJSON } from "hono/pretty-json";
import type { PrismaLike } from "../db/types";
import { registerIndexRoutes } from "./indexRoutes";
import { registerUpdateRoutes } from "./updateRoutes";

export const api = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>();

api
  .use("*", cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }))
  .use(prettyJSON());

// Register existing route handlers
registerIndexRoutes(api as unknown as any);
registerUpdateRoutes(api as unknown as any);

// Basic health route to mirror previous "/"
api.get("/", c => c.json({ ok: true }));

// Export default for convenience
export default api;


