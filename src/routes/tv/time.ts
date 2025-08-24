import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const ResponseSchema = z.string();

const route = createRoute({
  method: "get",
  path: "/time",
  responses: {
    200: { description: "Unix time as text", content: { "text/plain": { schema: ResponseSchema } } },
  },
});

export const tvTime = new OpenAPIHono().openapi(route, async (c) => {
  return c.text(String(Math.floor(Date.now() / 1000)));
});


