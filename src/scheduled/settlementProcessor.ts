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

// Process a single settlement with optimized timeout and retry logic
async function processSettlementWithRetry(c: any, pending: any, retryCount = 0): Promise<{ success: boolean; error?: string }> {
  const signature = pending.depositSig;
  const maxRetries = 2;
  const baseTimeout = 30000; // 30 seconds base timeout
  const timeout = baseTimeout + (retryCount * 10000); // Increase timeout with retries
  
  // Get webhook event for additional context
  const webhookEvent = await getWebhookEvent(c, signature);
  
  L({ 
    lvl: 'info', 
    msg: 'processing.settlement', 
    signature: signature.substring(0, 8) + '...',
    side: pending.side,
    hasWebhookEvent: !!webhookEvent,
    webhookTimestamp: webhookEvent?.timestamp,
    retryCount,
    timeoutMs: timeout
  });

  try {
    // Create a timeout promise with better error message
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Settlement processing timeout after ${timeout}ms (attempt ${retryCount + 1}/${maxRetries + 1})`));
      }, timeout);
    });

    // Race between processing and timeout
    await Promise.race([
      processDepositSignature(c, signature),
      timeoutPromise
    ]);

    L({ 
      lvl: 'info', 
      msg: 'settlement.completed', 
      signature: signature.substring(0, 8) + '...',
      retryCount
    });

    return { success: true };

  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const isTimeout = errorMsg.includes('timeout');
    const isRetryable = isTimeout && retryCount < maxRetries;
    
    L({ 
      lvl: isRetryable ? 'warn' : 'error', 
      msg: isRetryable ? 'settlement.retry' : 'settlement.failed', 
      signature: signature.substring(0, 8) + '...',
      error: errorMsg,
      webhookEventType: webhookEvent?.eventData?.type,
      webhookSlot: webhookEvent?.eventData?.slot,
      retryCount,
      willRetry: isRetryable
    });

    if (isRetryable) {
      // Wait before retry (exponential backoff)
      const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return processSettlementWithRetry(c, pending, retryCount + 1);
    }

    // Mark as failed in the store
    await markFailed(c, signature, errorMsg);
    return { success: false, error: errorMsg };
  }
}

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

    // Process settlements in parallel with concurrency limit
    const concurrencyLimit = 3; // Process up to 3 settlements simultaneously
    const chunks = [];
    for (let i = 0; i < pendingSettlements.length; i += concurrencyLimit) {
      chunks.push(pendingSettlements.slice(i, i + concurrencyLimit));
    }

    for (const chunk of chunks) {
      // Process chunk in parallel
      const chunkPromises = chunk.map(async (pending) => {
        const result = await processSettlementWithRetry(c, pending);
        results.processed++;
        
        if (result.success) {
          results.completed++;
        } else {
          results.failed++;
          if (result.error) {
            results.errors.push(`${pending.depositSig}: ${result.error}`);
          }
        }
        
        return result;
      });

      // Wait for all settlements in this chunk to complete
      await Promise.allSettled(chunkPromises);
    }

    const totalTime = Date.now() - startTime;
    L({ 
      lvl: 'info', 
      msg: 'scheduler.completed',
      totalTimeMs: totalTime,
      results,
      avgTimePerSettlement: Math.round(totalTime / results.processed)
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
