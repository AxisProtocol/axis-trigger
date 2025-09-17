// Simple KV cache helpers for Cloudflare Workers. If KV is not bound, falls back to compute.

export async function kvGet<T>(c: any, key: string): Promise<T | null> {
  try {
    const kv = ((c as any).env as any)?.CACHE as any;
    if (!kv) return null;
    const val = await kv.get(key);
    if (!val) return null;
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

export async function kvSet<T>(c: any, key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    const kv = ((c as any).env as any)?.CACHE as any;
    if (!kv) return;
    await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(1, Math.floor(ttlSeconds)) } as any);
  } catch {
    // ignore
  }
}

export async function withKvCache<T>(c: any, key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const cached = await kvGet<T>(c, key);
  if (cached !== null) return cached;
  const fresh = await compute();
  await kvSet(c, key, fresh, ttlSeconds);
  return fresh;
}


