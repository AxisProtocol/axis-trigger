import type { KVNamespace } from "@cloudflare/workers-types";

// KV-based settlement tracking for Cloudflare Workers
interface PendingTransaction {
  side: 'mint' | 'burn';
  depositSig: string;
  usdcUi?: number;
  axisUi?: number;
  timestamp: number;
}

interface CompletedTransaction {
  side: 'mint' | 'burn';
  indexValue: number;
  axisUi?: number;
  usdcUi?: number;
  payoutSig: string;
  timestamp: number;
}

interface FailedTransaction {
  error: string;
  timestamp: number;
}

interface SettlementRecord {
  phase: 'pending' | 'completed' | 'failed';
  side: 'mint' | 'burn';
  depositSig: string;
  usdcUi?: number;
  axisUi?: number;
  indexValue?: number;
  payoutSig?: string;
  error?: string;
  timestamp: number;
}

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

export async function putPending(
  c: any,
  signature: string, 
  data: { side: 'mint' | 'burn'; depositSig: string; usdcUi?: number; axisUi?: number }
): Promise<void> {
  const kv = getKV(c);
  
  if (!kv) {
    console.error('[Settlement Store] KV store not available, cannot store pending transaction');
    throw new Error('KV store not available');
  }

  const record: SettlementRecord = {
    phase: 'pending',
    side: data.side,
    depositSig: data.depositSig,
    usdcUi: data.usdcUi,
    axisUi: data.axisUi,
    timestamp: Date.now(),
  };

  try {
    await kv.put(`pending:${signature}`, JSON.stringify(record), { expirationTtl: 86400 }); // 24h TTL
    console.log(`[Settlement Store] Successfully stored pending record: ${signature}`);
  } catch (error) {
    console.error(`[Settlement Store] Failed to store pending record ${signature}:`, error);
    throw error;
  }
}

export async function markPaid(
  c: any,
  signature: string,
  data: { indexValue: number; axisUi?: number; usdcUi?: number; payoutSig: string }
): Promise<void> {
  const kv = getKV(c);
  if (!kv) {
    console.warn('KV store not available, using fallback');
    return;
  }

  const pending = await getPending(c, signature);
  if (!pending) {
    console.warn(`No pending transaction found for signature: ${signature}`);
    return;
  }
  
  const record: SettlementRecord = {
    phase: 'completed',
    side: pending.side,
    depositSig: pending.depositSig,
    usdcUi: pending.usdcUi,
    axisUi: pending.axisUi,
    indexValue: data.indexValue,
    payoutSig: data.payoutSig,
    timestamp: Date.now(),
  };

  await kv.put(`completed:${signature}`, JSON.stringify(record), { expirationTtl: 604800 }); // 7 days TTL
  await kv.delete(`pending:${signature}`);
}

export async function markFailed(c: any, signature: string, error: string): Promise<void> {
  const kv = getKV(c);
  if (!kv) {
    console.warn('KV store not available, using fallback');
    return;
  }

  const pending = await getPending(c, signature);
  const record: SettlementRecord = {
    phase: 'failed',
    side: pending?.side || 'mint',
    depositSig: signature,
    error,
    timestamp: Date.now(),
  };

  await kv.put(`failed:${signature}`, JSON.stringify(record), { expirationTtl: 604800 }); // 7 days TTL
  await kv.delete(`pending:${signature}`);
}

export async function getPending(c: any, signature: string): Promise<PendingTransaction | undefined> {
  const kv = getKV(c);
  if (!kv) return undefined;

  const data = await kv.get(`pending:${signature}`);
  if (!data) return undefined;

  const record: SettlementRecord = JSON.parse(data);
  return {
    side: record.side,
    depositSig: record.depositSig,
    usdcUi: record.usdcUi,
    axisUi: record.axisUi,
    timestamp: record.timestamp,
  };
}

export async function getCompleted(c: any, signature: string): Promise<CompletedTransaction | undefined> {
  const kv = getKV(c);
  if (!kv) return undefined;

  const data = await kv.get(`completed:${signature}`);
  if (!data) return undefined;

  const record: SettlementRecord = JSON.parse(data);
  return {
    side: record.side,
    indexValue: record.indexValue!,
    axisUi: record.axisUi,
    usdcUi: record.usdcUi,
    payoutSig: record.payoutSig!,
    timestamp: record.timestamp,
  };
}

export async function getFailed(c: any, signature: string): Promise<FailedTransaction | undefined> {
  const kv = getKV(c);
  if (!kv) return undefined;

  const data = await kv.get(`failed:${signature}`);
  if (!data) return undefined;

  const record: SettlementRecord = JSON.parse(data);
  return {
    error: record.error!,
    timestamp: record.timestamp,
  };
}

export async function getOne(c: any, signature: string): Promise<SettlementRecord | undefined> {
  const kv = getKV(c);
  if (!kv) return undefined;

  // Try completed first, then failed, then pending
  const completed = await kv.get(`completed:${signature}`);
  if (completed) return JSON.parse(completed);

  const failed = await kv.get(`failed:${signature}`);
  if (failed) return JSON.parse(failed);

  const pending = await kv.get(`pending:${signature}`);
  if (pending) return JSON.parse(pending);

  return undefined;
}

export async function getAllPending(c: any): Promise<PendingTransaction[]> {
  const kv = getKV(c);
  if (!kv) return [];

  const { keys } = await kv.list({ prefix: 'pending:' });
  const results: PendingTransaction[] = [];

  for (const key of keys) {
    const data = await kv.get(key.name);
    if (data) {
      const record: SettlementRecord = JSON.parse(data);
      results.push({
        side: record.side,
        depositSig: record.depositSig,
        usdcUi: record.usdcUi,
        axisUi: record.axisUi,
        timestamp: record.timestamp,
      });
    }
  }

  return results;
}

export async function getAllCompleted(c: any): Promise<CompletedTransaction[]> {
  const kv = getKV(c);
  if (!kv) return [];

  const { keys } = await kv.list({ prefix: 'completed:' });
  const results: CompletedTransaction[] = [];

  for (const key of keys) {
    const data = await kv.get(key.name);
    if (data) {
      const record: SettlementRecord = JSON.parse(data);
      results.push({
        side: record.side,
        indexValue: record.indexValue!,
        axisUi: record.axisUi,
        usdcUi: record.usdcUi,
        payoutSig: record.payoutSig!,
        timestamp: record.timestamp,
      });
    }
  }

  return results;
}

export async function getAllFailed(c: any): Promise<FailedTransaction[]> {
  const kv = getKV(c);
  if (!kv) return [];

  const { keys } = await kv.list({ prefix: 'failed:' });
  const results: FailedTransaction[] = [];

  for (const key of keys) {
    const data = await kv.get(key.name);
    if (data) {
      const record: SettlementRecord = JSON.parse(data);
      results.push({
        error: record.error!,
        timestamp: record.timestamp,
      });
    }
  }

  return results;
}
