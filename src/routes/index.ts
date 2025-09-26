import { OpenAPIHono } from "@hono/zod-openapi";
import type { PrismaLike } from "../db/types";
import { famc } from "./api/famc";
import { avgindexprice } from "./api/avgindexprice";
import { famcindexprice } from "./api/famcindexprice";
import { update } from "./api/update";
import { selection } from "./api/selection";
import { heliusWebhook } from "./api/heliusWebhook";
import { settlementApi } from "./api/settlement";
import { tvConfig } from "./tv/config";
import { tvTime } from "./tv/time";
import { tvSymbols } from "./tv/symbols";
import { tvHistory } from "./tv/history";
import { symbolsApi } from "./api/symbols";

export const api = new OpenAPIHono<{ Variables: { prisma: PrismaLike } }>();

// Mount API endpoints
api.route("/api", famc);
api.route("/api", avgindexprice);
api.route("/api", heliusWebhook);
api.route("/api", settlementApi);
api.route("/api", famcindexprice);
api.route("/api", update);
api.route("/api", selection);
api.route("/api", symbolsApi);
// Mount TradingView endpoints
api.route("/tv", tvConfig);
api.route("/tv", tvTime);
api.route("/tv", tvSymbols);
api.route("/tv", tvHistory);

// Basic health route to mirror previous "/"
api.get("/", c => c.json({ ok: true }));

// Export default for convenience
export default api;


