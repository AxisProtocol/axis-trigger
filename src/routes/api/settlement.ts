import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getOne } from '../../lib/settlementStore';
import type { KVNamespace } from "@cloudflare/workers-types";

// KV store interface
interface CloudflareBindings {
  SETTLEMENTS_KV: KVNamespace;
}

const getKV = (c: any): KVNamespace | null => {
  try {
    console.log('Getting KV store', c.env?.SETTLEMENTS_KV);
    return c.env?.SETTLEMENTS_KV || null;
  } catch {
    console.log('Error getting KV store');
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

export const settlementApi = new OpenAPIHono().openapi(route, async (c) => {
  try {
    const { sig } = c.req.valid('param');

    if (!sig) {
      console.log('[Settlement API] Missing signature parameter');
      return c.json({ error: 'Signature parameter is required' }, 400);
    }

    console.log(`[Settlement API] Checking settlement for signature: ${sig}`);

    // Get settlement data from the store
    const settlementRecord = await getOne(c, sig);
    
    // Get webhook event from KV
    const webhookEvent = await getWebhookEvent(c, sig);
    
    if (settlementRecord) {
      console.log(`[Settlement API] Found settlement record:`, settlementRecord);
      
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
      
      console.log(`[Settlement API] Returning settlement data:`, responseData);
      return c.json(responseData);
    } else {
      console.log(`[Settlement API] No settlement record found for signature: ${sig}`);
      
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
      
      console.log(`[Settlement API] Returning default pending record:`, defaultRecord);
      return c.json(defaultRecord);
    }

  } catch (error) {
    console.error('[Settlement API] Error fetching settlement:', error);
    return c.json(
      { error: 'Internal server error' },
      500
    );
  }
});
