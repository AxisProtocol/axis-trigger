import dotenv from "dotenv";
dotenv.config();

import { swaggerUI } from "@hono/swagger-ui";
import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import { prisma } from "./db/client";
import type { PrismaLike } from "./db/types";
import { api } from "./routes";

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
  // Inject singleton Prisma for Node server
  .use("/*", async (c: Context, next: Next) => {
    (c as any).set("prisma", prisma as unknown as PrismaLike);
    await next();
  })
  .route("/", api);

const port = 8081;
// eslint-disable-next-line no-console
console.log(`Server is running on port ${port}, open http://localhost:${port}/docs to see the documentation`);

serve({
  fetch: app.fetch,
  port,
});


