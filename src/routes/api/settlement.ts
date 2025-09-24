import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getOne } from '../../lib/settlementStore';
import type { KVNamespace } from "@cloudflare/workers-types";

// KV store interface
interface CloudflareBindings {
  SETTLEMENTS_KV: KVNamespace;
}

const getKV = (c: any): KVNamespace | null => {
  try {
    return c.env?.SETTLEMENTS_KV || null;
  } catch {
    return null;
  }
};

// Get webhook event from KV
async function getWebhookEvent(c: any, signature: string) {
  const kv = getKV(c);
  if (!kv) return null;
  
  const eventData = await kv.get(`webhook:${signature}`);
  if (!eventData) return null;
  
  return JSON.parse(eventData);
}

const SettlementResponseSchema = z.object({
  record: z.object({
    phase: z.enum(['pending', 'completed', 'failed']),
    side: z.enum(['mint', 'burn']),
    depositSig: z.string(),
    usdcUi: z.number().optional(),
    axisUi: z.number().optional(),
    indexValue: z.number().optional(),
    payoutSig: z.string().optional(),
    error: z.string().optional(),
    timestamp: z.number(),
  }).optional(),
  webhookEvent: z.any().optional(),
});

const ErrorResponseSchema = z.object({
  error: z.string(),
});

const route = createRoute({
  method: "get",
  path: "/settlement/{sig}",
  request: {
    params: z.object({
      sig: z.string().openapi({ param: { name: 'sig', in: 'path' } }),
    }),
  },
  responses: {
    200: { 
      description: "Settlement status retrieved successfully", 
      content: { 
        "application/json": { 
          schema: SettlementResponseSchema 
        } 
      } 
    },
    400: { 
      description: "Bad request", 
      content: { 
        "application/json": { 
          schema: ErrorResponseSchema 
        } 
      } 
    },
    500: { 
      description: "Internal server error", 
      content: { 
        "application/json": { 
          schema: ErrorResponseSchema 
        } 
      } 
    },
  },
});

// Helper function for settlement logic
async function handleSettlementRequest(c: any, sig: string) {
  console.log(`[Settlement API] Request from origin: ${c.req.header('origin')}`);
  console.log(`[Settlement API] Request headers:`, Object.fromEntries(c.req.raw.headers.entries()));
  console.log(`[Settlement API] Processing request for signature: ${sig}`);

  // Get settlement data from the store
  const settlementRecord = await getOne(c, sig);
  
  // Get webhook event from KV
  const webhookEvent = await getWebhookEvent(c, sig);
  
  if (settlementRecord) {
    // Return the record in the format expected by the modal
    const responseData = {
      record: {
        phase: settlementRecord.phase,
        side: settlementRecord.side,
        depositSig: settlementRecord.depositSig,
        usdcUi: settlementRecord.usdcUi,
        axisUi: settlementRecord.axisUi,
        indexValue: settlementRecord.indexValue,
        payoutSig: settlementRecord.payoutSig,
        error: settlementRecord.error,
        timestamp: settlementRecord.timestamp,
      },
      webhookEvent
    } as any;
    
    return c.json(responseData);
  } else {
    // Return a pending record if none exists (this might happen for new transactions)
    const defaultRecord = {
      record: {
        phase: 'pending' as const,
        side: 'mint' as const,
        depositSig: sig,
        timestamp: Date.now(),
      },
      webhookEvent
    } as any;
    
    return c.json(defaultRecord);
  }
}

// Create regular Hono instance for basic routes
const settlementHono = new OpenAPIHono()
  .get("/test", (c) => {
    console.log(`[Settlement Test] Request from origin: ${c.req.header('origin')}`);
    return c.json({ message: "Settlement API is working", origin: c.req.header('origin') });
  })
  .get("/settlement/:sig", async (c) => {
    try {
      const sig = c.req.param('sig');

      if (!sig) {
        console.log(`[Settlement API] Missing signature parameter`);
        return c.json({ error: 'Signature parameter is required' }, 400);
      }
      
      return await handleSettlementRequest(c, sig);

    } catch (error) {
      console.error('[Settlement API] Error:', error);
      return c.json(
        { error: 'Internal server error' },
        500
      );
    }
  });

// Create OpenAPI instance for OpenAPI route
const settlementOpenAPI = new OpenAPIHono()
  .openapi(route, async (c: any) => {
  try {
    const { sig } = c.req.valid('param');

    if (!sig) {
      console.log(`[Settlement API OpenAPI] Missing signature parameter`);
      return c.json({ error: 'Signature parameter is required' }, 400);
    }
    
    return await handleSettlementRequest(c, sig);

  } catch (error) {
    console.error('[Settlement API OpenAPI] Error:', error);
    return c.json(
      { error: 'Internal server error' },
      500
    );
  }
});

// Export combined API
export const settlementApi = new OpenAPIHono()
  .route("/", settlementHono)
  .route("/", settlementOpenAPI);
