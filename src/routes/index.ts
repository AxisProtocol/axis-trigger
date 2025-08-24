import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { swaggerUI } from "@hono/swagger-ui";
import { prettyJSON } from "hono/pretty-json";
import type { PrismaLike } from "../db/types";
import { famc } from "./api/famc";
import { avgindexprice } from "./api/avgindexprice";
import { famcindexprice } from "./api/famcindexprice";
import { update } from "./api/update";
import { tvConfig } from "./tv/config";
import { tvTime } from "./tv/time";
import { tvSymbols } from "./tv/symbols";
import { tvHistory } from "./tv/history";
import { appUi } from "./app/ui";

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

// Mount API endpoints
api.route("/api", famc);
api.route("/api", avgindexprice);
api.route("/api", famcindexprice);
api.route("/api", update);

// Mount TradingView endpoints
api.route("/tv", tvConfig);
api.route("/tv", tvTime);
api.route("/tv", tvSymbols);
api.route("/tv", tvHistory);

// Mount App UI
api.route("/app", appUi);

// Basic health route to mirror previous "/"
api.get("/", c => c.json({ ok: true }));

// Export default for convenience
export default api;


