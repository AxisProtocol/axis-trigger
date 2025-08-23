import dotenv from "dotenv";
dotenv.config();

import { serve } from "@hono/node-server";
import { createBaseApp } from "./app";
import { registerIndexRoutes } from "./routes/indexRoutes";

const app = createBaseApp({ includeDbRoutesInDocs: true });

registerIndexRoutes(app);

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`OpenAPI docs on http://localhost:${port}/docs`);


