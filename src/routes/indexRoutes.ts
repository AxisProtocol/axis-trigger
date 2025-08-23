import type { Hono } from "hono";
import { computeIndexSeries, SUPPORTED_RESOLUTIONS } from "../services/indexSeries";
import type { Resolution } from "../services/indexSeries";

export function registerIndexRoutes(app: Hono): void {
  app.get("/api/index", async c => {
    const from = Number(c.req.query("from")) || Math.floor(new Date(Date.now() - 7 * 86400_000).getTime() / 1000);
    const to = Number(c.req.query("to")) || Math.floor(Date.now() / 1000);
    const resolution = (c.req.query("resolution") as Resolution) || "60";
    if (!SUPPORTED_RESOLUTIONS.includes(resolution)) {
      return c.json({ message: "invalid resolution" }, 400);
    }
    const { t, c: values } = await computeIndexSeries(from, to, resolution);
    return c.json({ t, value: values, resolution });
  });

  app.get("/tv/history", async c => {
    const symbol = (c.req.query("symbol") || "INDEX:FAMC").toUpperCase();
    const resolution = (c.req.query("resolution") as Resolution) || "60";
    const from = Number(c.req.query("from"));
    const to = Number(c.req.query("to"));
    if (!from || !to) {
      return c.json({ s: "error", errmsg: "from/to required (unix seconds)" }, 400);
    }
    if (!SUPPORTED_RESOLUTIONS.includes(resolution)) {
      return c.json({ s: "error", errmsg: "invalid resolution" }, 400);
    }
    const { t, c: values } = await computeIndexSeries(from, to, resolution);
    if (t.length === 0) return c.json({ s: "no_data" });
    const o = values.slice();
    const h = values.slice();
    const l = values.slice();
    const v = new Array(values.length).fill(0);
    return c.json({ s: "ok", t, c: values, o, h, l, v, symbol });
  });
}


