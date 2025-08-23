import dotenv from "dotenv";
dotenv.config();

import { serve } from "@hono/node-server";
import { createBaseApp } from "./app";
import { registerIndexRoutes } from "./routes/indexRoutes";
import { prisma } from "./db/client";
import type { PrismaLike } from "./db/types";

const app = createBaseApp({ includeDbRoutesInDocs: true });

// Inject singleton Prisma for Node server
app.use("/*", async (c, next) => {
  (c as any).set("prisma", prisma as unknown as PrismaLike);
  await next();
});

registerIndexRoutes(app);

const port = Number(process.env.PORT || 8789);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`OpenAPI docs on http://localhost:${port}/docs`);


