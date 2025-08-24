import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const ResponseSchema = z.object({
  supports_search: z.boolean(),
  supports_group_request: z.boolean(),
  supports_marks: z.boolean(),
  supports_timescale_marks: z.boolean(),
  supports_time: z.boolean(),
  supported_resolutions: z.array(z.string()),
});

const route = createRoute({
  method: "get",
  path: "/config",
  responses: {
    200: { description: "Config", content: { "application/json": { schema: ResponseSchema } } },
  },
});

export const tvConfig = new OpenAPIHono().openapi(route, async (c) => {
  return c.json({
    supports_search: false,
    supports_group_request: false,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    supported_resolutions: ["1", "5", "15", "60", "240", "D"],
  });
});


