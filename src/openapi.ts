// Minimal OpenAPI 3.1 spec describing current routes
// Keep schemas concise; update as the API evolves

export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Axis Trigger API",
    version: "0.1.0",
    description:
      "API for computing FAMC index data and TradingView-compatible endpoints.",
  },
  servers: [
    { url: "/" },
  ],
  paths: {
    "/": {
      get: {
        summary: "Health check",
        responses: {
          "200": {
            description: "Service is up",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean" } },
                },
              },
            },
          },
        },
      },
    },
    "/api/index": {
      get: {
        summary: "Get index close-only series",
        parameters: [
          {
            in: "query",
            name: "from",
            required: false,
            schema: { type: "integer", format: "int64" },
            description: "Start time (unix seconds). Defaults to 7 days ago.",
          },
          {
            in: "query",
            name: "to",
            required: false,
            schema: { type: "integer", format: "int64" },
            description: "End time (unix seconds). Defaults to now.",
          },
          {
            in: "query",
            name: "resolution",
            required: false,
            schema: {
              type: "string",
              enum: ["1", "5", "15", "60", "240", "D"],
              default: "60",
            },
            description: "Bucket size.",
          },
        ],
        responses: {
          "200": {
            description: "Close-only series",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    t: { type: "array", items: { type: "integer", format: "int64" } },
                    value: { type: "array", items: { type: "number" } },
                    resolution: {
                      type: "string",
                      enum: ["1", "5", "15", "60", "240", "D"],
                    },
                  },
                  required: ["t", "value", "resolution"],
                },
              },
            },
          },
        },
      },
    },
    "/tv/config": {
      get: {
        summary: "TradingView UDF config",
        responses: {
          "200": {
            description: "Config",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    supports_search: { type: "boolean" },
                    supports_group_request: { type: "boolean" },
                    supports_marks: { type: "boolean" },
                    supports_timescale_marks: { type: "boolean" },
                    supports_time: { type: "boolean" },
                    supported_resolutions: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/tv/time": {
      get: {
        summary: "TradingView UDF time",
        responses: {
          "200": {
            description: "Unix time as text",
            content: { "text/plain": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/tv/symbols": {
      get: {
        summary: "TradingView UDF symbol metadata",
        parameters: [
          {
            in: "query",
            name: "symbol",
            required: false,
            schema: { type: "string" },
            description: "Symbol, default INDEX:FAMC",
          },
        ],
        responses: {
          "200": {
            description: "Symbol info",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    ticker: { type: "string" },
                    description: { type: "string" },
                    type: { type: "string" },
                    session: { type: "string" },
                    timezone: { type: "string" },
                    minmov: { type: "integer" },
                    pricescale: { type: "integer" },
                    has_intraday: { type: "boolean" },
                    supported_resolutions: { type: "array", items: { type: "string" } },
                    has_daily: { type: "boolean" },
                    has_weekly_and_monthly: { type: "boolean" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/tv/history": {
      get: {
        summary: "TradingView UDF history",
        parameters: [
          { in: "query", name: "symbol", required: false, schema: { type: "string" } },
          {
            in: "query",
            name: "resolution",
            required: false,
            schema: { type: "string", enum: ["1", "5", "15", "60", "240", "D"], default: "60" },
          },
          { in: "query", name: "from", required: true, schema: { type: "integer", format: "int64" } },
          { in: "query", name: "to", required: true, schema: { type: "integer", format: "int64" } },
        ],
        responses: {
          "200": {
            description: "Series data or no_data",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      properties: {
                        s: { type: "string", enum: ["ok"] },
                        t: { type: "array", items: { type: "integer", format: "int64" } },
                        c: { type: "array", items: { type: "number" } },
                        o: { type: "array", items: { type: "number" } },
                        h: { type: "array", items: { type: "number" } },
                        l: { type: "array", items: { type: "number" } },
                        v: { type: "array", items: { type: "number" } },
                        symbol: { type: "string" },
                      },
                      required: ["s", "t", "c", "o", "h", "l", "v"],
                    },
                    { type: "object", properties: { s: { type: "string", enum: ["no_data"] } }, required: ["s"] },
                  ],
                },
              },
            },
          },
          "400": {
            description: "Invalid request",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { s: { type: "string", enum: ["error"] }, errmsg: { type: "string" } },
                  required: ["s", "errmsg"],
                },
              },
            },
          },
        },
      },
    },
  },
} as const;


