import { getAllPending, markPaid, markFailed } from '../lib/settlementStore';
import { processDepositSignature } from '../lib/settlementProcessor';
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

const L = (o: any) => console.log(JSON.stringify({ ts: new Date().toISOString(), mod: 'settlement-scheduler', ...o }));

export async function processPendingSettlements(c: any) {
  const startTime = Date.now();
  L({ lvl: 'info', msg: 'scheduler.start' });

  try {
    // Get all pending settlements
    const pendingSettlements = await getAllPending(c);
    L({ 
      lvl: 'info', 
      msg: 'pending.settlements.found', 
      count: pendingSettlements.length 
    });

    if (pendingSettlements.length === 0) {
      L({ lvl: 'info', msg: 'no.pending.settlements' });
      return;
    }

    const results = {
      processed: 0,
      completed: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Process each pending settlement with timeout protection
    for (const pending of pendingSettlements) {
      const signature = pending.depositSig;
      const timeout = 55000; // 55 seconds timeout per settlement
      
      // Get webhook event for additional context
      const webhookEvent = await getWebhookEvent(c, signature);
      
      L({ 
        lvl: 'info', 
        msg: 'processing.settlement', 
        signature: signature.substring(0, 8) + '...',
        side: pending.side,
        hasWebhookEvent: !!webhookEvent,
        webhookTimestamp: webhookEvent?.timestamp
      });

      try {
        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Settlement processing timeout')), timeout);
        });

        // Race between processing and timeout
        await Promise.race([
          processDepositSignature(c, signature),
          timeoutPromise
        ]);

        results.completed++;
        L({ 
          lvl: 'info', 
          msg: 'settlement.completed', 
          signature: signature.substring(0, 8) + '...' 
        });

      } catch (error: any) {
        results.failed++;
        const errorMsg = error?.message || String(error);
        results.errors.push(`${signature}: ${errorMsg}`);
        
        L({ 
          lvl: 'error', 
          msg: 'settlement.failed', 
          signature: signature.substring(0, 8) + '...',
          error: errorMsg,
          webhookEventType: webhookEvent?.eventData?.type,
          webhookSlot: webhookEvent?.eventData?.slot
        });

        // Mark as failed in the store
        await markFailed(c, signature, errorMsg);
      }

      results.processed++;
    }

    const totalTime = Date.now() - startTime;
    L({ 
      lvl: 'info', 
      msg: 'scheduler.completed',
      totalTimeMs: totalTime,
      results
    });

  } catch (error: any) {
    L({ 
      lvl: 'error', 
      msg: 'scheduler.failed', 
      error: error?.message || String(error) 
    });
  }
}

// Export for use in scheduled functions
export default {
  async scheduled(event: any, env: any, ctx: any) {
    L({ lvl: 'info', msg: 'scheduled.execution.start', cron: event.cron });
    await processPendingSettlements({ env });
  }
};
