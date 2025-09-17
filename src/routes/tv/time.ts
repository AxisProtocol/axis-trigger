import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { withKvCache } from "../../utils/kvCache";

const ResponseSchema = z.string();

const route = createRoute({
  method: "get",
  path: "/time",
  responses: {
    200: { description: "Unix time as text", content: { "text/plain": { schema: ResponseSchema } } },
  },
});

export const tvTime = new OpenAPIHono().openapi(route, async (c) => {
  const now = await withKvCache<number>(c, `tv:time:now`, 2, async () => Math.floor(Date.now() / 1000));
  return c.text(String(now));
});


