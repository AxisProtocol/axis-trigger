import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { PublicKey } from '@solana/web3.js';
import { putPending } from '../../lib/settlementStore';
import { classifyDeposit } from '../../lib/settlementProcessor';
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

// ----- env & const -----
const AUTH = process.env.HELIUS_WEBHOOK_TOKEN || '';

// ----- logging helper -----
const L = (o: any) => console.log(JSON.stringify({ ts: new Date().toISOString(), mod: 'helius-webhook', ...o }));

// ----- KV storage helpers -----
async function storeWebhookEvent(c: any, signature: string, eventData: any) {
  const kv = getKV(c);
  if (!kv) {
    L({ lvl: 'warn', msg: 'kv.not.available' });
    return;
  }

  const webhookRecord = {
    signature,
    timestamp: Date.now(),
    eventData: {
      type: eventData?.type || eventData?.transactionType,
      slot: eventData?.slot,
      description: eventData?.description,
      tokenTransfers: eventData?.tokenTransfers || [],
      accountData: eventData?.accountData || [],
    },
    processed: false
  };

  await kv.put(`webhook:${signature}`, JSON.stringify(webhookRecord), { 
    expirationTtl: 86400 // 24 hours
  });
  
  L({ lvl: 'debug', msg: 'webhook.event.stored', signature: signature.substring(0, 8) + '...' });
}

// ----- Fast deposit detection from Helius events -----
type Ev = any;

function scanUsdcDeposit(ev: Ev) {
  const USDC_DEV_MINT = process.env.USDC_DEV_MINT;
  const TREASURY_OWNER = process.env.TREASURY_OWNER;
  
  L({ 
    lvl: 'debug', 
    msg: 'scan.usdc.start',
    hasUsdcMint: !!USDC_DEV_MINT,
    hasTreasuryOwner: !!TREASURY_OWNER,
    usdcMint: USDC_DEV_MINT?.substring(0, 8) + '...',
    treasuryOwner: TREASURY_OWNER?.substring(0, 8) + '...'
  });
  
  if (!TREASURY_OWNER || !USDC_DEV_MINT) {
    L({ lvl: 'warn', msg: 'scan.usdc.missing.config' });
    return null;
  }
  
  // Fast tokenTransfers scan
  const tts = Array.isArray(ev?.tokenTransfers) ? ev.tokenTransfers : [];
  L({ 
    lvl: 'debug', 
    msg: 'scan.usdc.tokenTransfers',
    count: tts.length,
    transfers: tts.map((t: any) => ({
      mint: t.mint?.substring(0, 8) + '...',
      fromUser: t.fromUserAccount?.substring(0, 8) + '...',
      toUser: t.toUserAccount?.substring(0, 8) + '...',
      amount: t.tokenAmount,
      isUsdcMint: t.mint === USDC_DEV_MINT,
      isToTreasury: t.toUserAccount === TREASURY_OWNER
    }))
  });
  
  for (const t of tts) {
    if (t.mint === USDC_DEV_MINT && t.toUserAccount === TREASURY_OWNER) {
      L({ 
        lvl: 'info', 
        msg: 'scan.usdc.found',
        fromUser: t.fromUserAccount?.substring(0, 8) + '...',
        amount: t.tokenAmount,
        mint: t.mint?.substring(0, 8) + '...'
      });
      return { fromUser: t.fromUserAccount as string, uiAmount: Number(t.tokenAmount) };
    }
  }
  
  L({ lvl: 'debug', msg: 'scan.usdc.no.match' });
  return null;
}

function scanAxisDeposit(ev: Ev) {
  const AXIS_MINT_2022 = process.env.AXIS_MINT_2022;
  const TREASURY_OWNER = process.env.TREASURY_OWNER;
  
  L({ 
    lvl: 'debug', 
    msg: 'scan.axis.start',
    hasAxisMint: !!AXIS_MINT_2022,
    hasTreasuryOwner: !!TREASURY_OWNER,
    axisMint: AXIS_MINT_2022?.substring(0, 8) + '...',
    treasuryOwner: TREASURY_OWNER?.substring(0, 8) + '...'
  });
  
  if (!TREASURY_OWNER || !AXIS_MINT_2022) {
    L({ lvl: 'warn', msg: 'scan.axis.missing.config' });
    return null;
  }
  
  // Fast tokenTransfers scan
  const tts = Array.isArray(ev?.tokenTransfers) ? ev.tokenTransfers : [];
  L({ 
    lvl: 'debug', 
    msg: 'scan.axis.tokenTransfers',
    count: tts.length,
    transfers: tts.map((t: any) => ({
      mint: t.mint?.substring(0, 8) + '...',
      fromUser: t.fromUserAccount?.substring(0, 8) + '...',
      toUser: t.toUserAccount?.substring(0, 8) + '...',
      amount: t.tokenAmount,
      isAxisMint: t.mint === AXIS_MINT_2022,
      isToTreasury: t.toUserAccount === TREASURY_OWNER
    }))
  });
  
  for (const t of tts) {
    if (t.mint === AXIS_MINT_2022 && t.toUserAccount === TREASURY_OWNER) {
      L({ 
        lvl: 'info', 
        msg: 'scan.axis.found',
        fromUser: t.fromUserAccount?.substring(0, 8) + '...',
        amount: t.tokenAmount,
        mint: t.mint?.substring(0, 8) + '...'
      });
      return { fromUser: t.fromUserAccount as string, uiAmount: Number(t.tokenAmount) };
    }
  }
  
  L({ lvl: 'debug', msg: 'scan.axis.no.match' });
  return null;
}

// ----- OpenAPI schemas -----
const HeliusWebhookBodySchema = z.any();

const HeliusWebhookResponseSchema = z.object({
  ok: z.literal(true),
  recorded: z.array(z.object({
    sig: z.string(),
    side: z.enum(['mint', 'burn']),
    fromUser: z.string(),
    uiAmount: z.number(),
  })),
});

const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});

const postRoute = createRoute({
  method: "post",
  path: "/helius-webhook",
  request: {
    headers: z.object({
      "authorization": z.string(),
      "user-agent": z.string().optional(),
    }).openapi({ title: "HeliusWebhookHeaders" }),
    body: {
      content: { 
        "application/json": { 
          schema: HeliusWebhookBodySchema 
        } 
      },
    },
  },
  responses: {
    200: { 
      description: "Webhook processed successfully", 
      content: { 
        "application/json": { 
          schema: HeliusWebhookResponseSchema 
        } 
      } 
    },
    401: { 
      description: "Unauthorized", 
      content: { 
        "application/json": { 
          schema: ErrorResponseSchema 
        } 
      } 
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/helius-webhook",
  request: {
    headers: z.object({
      "authorization": z.string().optional(),
    }).openapi({ title: "HeliusWebhookGetHeaders" }),
    query: z.object({
      sig: z.string().optional(),
    }).openapi({ title: "HeliusWebhookQuery" }),
  },
  responses: {
    200: { 
      description: "Webhook status retrieved successfully", 
      content: { 
        "application/json": { 
          schema: z.object({
            ok: z.literal(true),
            status: z.string(),
            timestamp: z.string(),
            config: z.object({
              hasAuth: z.boolean(),
              usdcMint: z.string(),
              treasuryOwner: z.string(),
              axisMint: z.string(),
            }),
            webhookEvent: z.any().optional(),
          })
        } 
      } 
    },
    401: { 
      description: "Unauthorized", 
      content: { 
        "application/json": { 
          schema: ErrorResponseSchema 
        } 
      } 
    },
  },
});

// POST handler for webhook processing
const postHandler = async (c: any) => {
  const startTime = Date.now();
  
  // Fast auth check
  const gotAuth = String(c.req.header('authorization') || '');
  if (AUTH && gotAuth !== AUTH) {
    L({ lvl: 'warn', msg: 'auth.failed' });
    return c.json({ ok: false, error: 'unauthorized' }, 401) as any;
  }

  const body = await c.req.json();
  const events: Ev[] = Array.isArray(body) ? body : (Array.isArray(body?.events) ? body.events : [body]);
  console.log('ev', events[0].signature);
  L({ 
    lvl: 'info', 
    msg: 'webhook.start',
    eventsCount: events.length,
    timestamp: new Date().toISOString()
  });

  const recorded: any[] = [];

  // Step 1: Store all events to KV first
  for (const ev of events) {
    const sig = ev?.signature;
    if (!sig) continue;
    
    await storeWebhookEvent(c, sig, ev);
  }

  // Step 2: Process events for deposits
  for (const ev of events) {
    const sig = ev?.signature;
    if (!sig) continue;

    L({ 
      lvl: 'debug', 
      msg: 'processing.event',
      signature: sig.substring(0, 8) + '...',
      type: ev?.type || ev?.transactionType,
      slot: ev?.slot,
      hasTokenTransfers: Array.isArray(ev?.tokenTransfers),
      tokenTransfersCount: ev?.tokenTransfers?.length || 0,
      hasAccountData: Array.isArray(ev?.accountData),
      accountDataCount: ev?.accountData?.length || 0,
      description: ev?.description
    });

    // Check USDC deposit (mint)
    L({ lvl: 'debug', msg: 'checking.usdc.deposit' });
    const usdcDeposit = scanUsdcDeposit(ev);
    if (usdcDeposit) {
      L({ 
        lvl: 'info', 
        msg: 'usdc.deposit.detected',
        signature: sig.substring(0, 8) + '...',
        fromUser: usdcDeposit.fromUser.substring(0, 8) + '...',
        amount: usdcDeposit.uiAmount
      });
      
      try {
        await putPending(c, sig, { 
          side: 'mint', 
          depositSig: sig, 
          usdcUi: usdcDeposit.uiAmount 
        });
        recorded.push({
          sig,
          side: 'mint',
          fromUser: usdcDeposit.fromUser,
          uiAmount: usdcDeposit.uiAmount
        });
        L({ lvl: 'info', msg: 'mint.recorded', sig: sig.substring(0, 8) + '...' });
      } catch (error) {
        L({ lvl: 'error', msg: 'mint.record.failed', sig: sig.substring(0, 8) + '...', error: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }

    // Check AXIS deposit (burn)
    L({ lvl: 'debug', msg: 'checking.axis.deposit' });
    const axisDeposit = scanAxisDeposit(ev);
    if (axisDeposit) {
      L({ 
        lvl: 'info', 
        msg: 'axis.deposit.detected',
        signature: sig.substring(0, 8) + '...',
        fromUser: axisDeposit.fromUser.substring(0, 8) + '...',
        amount: axisDeposit.uiAmount
      });
      
      try {
        await putPending(c, sig, { 
          side: 'burn', 
          depositSig: sig, 
          axisUi: axisDeposit.uiAmount 
        });
        recorded.push({
          sig,
          side: 'burn',
          fromUser: axisDeposit.fromUser,
          uiAmount: axisDeposit.uiAmount
        });
        L({ lvl: 'info', msg: 'burn.recorded', sig: sig.substring(0, 8) + '...' });
      } catch (error) {
        L({ lvl: 'error', msg: 'burn.record.failed', sig: sig.substring(0, 8) + '...', error: error instanceof Error ? error.message : String(error) });
      }
    } else {
      L({ 
        lvl: 'debug', 
        msg: 'no.deposit.detected',
        signature: sig.substring(0, 8) + '...'
      });
    }
  }

  const totalTime = Date.now() - startTime;
  L({ 
    lvl: 'info', 
    msg: 'webhook.completed',
    totalTimeMs: totalTime,
    recordedCount: recorded.length
  });

  return c.json({ ok: true, recorded }) as any;
};

// GET handler for webhook status
const getHandler = async (c: any) => {
  // Fast auth check
  const gotAuth = String(c.req.header('authorization') || '');
  if (AUTH && gotAuth !== AUTH) {
    L({ lvl: 'warn', msg: 'auth.failed' });
    return c.json({ ok: false, error: 'unauthorized' }, 401) as any;
  }

  const { sig } = c.req.valid('query');
  let webhookEvent = null;

  // If signature provided, fetch webhook event from KV
  if (sig) {
    const kv = getKV(c);
    if (kv) {
      const eventData = await kv.get(`webhook:${sig}`);
      if (eventData) {
        webhookEvent = JSON.parse(eventData);
        L({ lvl: 'info', msg: 'webhook.event.found', signature: sig.substring(0, 8) + '...' });
      } else {
        L({ lvl: 'warn', msg: 'webhook.event.not.found', signature: sig.substring(0, 8) + '...' });
      }
    }
  }

  const status = {
    ok: true,
    status: 'webhook_operational',
    timestamp: new Date().toISOString(),
    config: {
      hasAuth: !!AUTH,
      usdcMint: process.env.USDC_DEV_MINT || 'not-set',
      treasuryOwner: process.env.TREASURY_OWNER || 'not-set',
      axisMint: process.env.AXIS_MINT_2022 || 'not-set',
    },
    webhookEvent
  };

  L({ lvl: 'info', msg: 'webhook.status.check', config: status.config, hasWebhookEvent: !!webhookEvent });
  return c.json(status);
};

export const heliusWebhook = new OpenAPIHono()
  .openapi(postRoute, postHandler)
  .openapi(getRoute, getHandler);
