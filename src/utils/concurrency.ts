// Limited concurrency runner for Workers-safe parallelism
export async function mapWithConcurrency<I, O>(
  items: I[],
  limit: number,
  mapper: (item: I, index: number) => Promise<O>
): Promise<O[]> {
  const results: O[] = new Array(items.length) as O[];
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) break;
      results[current] = await mapper(items[current], current);
    }
  }

  const workersCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(new Array(workersCount).fill(0).map(() => worker()));
  return results;
}


