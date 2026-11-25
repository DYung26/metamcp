const WAITER_QUEUE_COMPACTION_THRESHOLD = 1024;

export function createConcurrencyLimiter(maxConcurrency: number) {
  const limit = Math.max(1, Math.floor(maxConcurrency));
  let active = 0;
  let waiterHead = 0;
  const waiters: Array<() => void> = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    } else {
      active += 1;
    }

    try {
      return await task();
    } finally {
      const next = waiters[waiterHead];
      if (next) {
        waiterHead += 1;
        if (waiterHead === waiters.length) {
          waiters.length = 0;
          waiterHead = 0;
        } else if (
          waiterHead >= WAITER_QUEUE_COMPACTION_THRESHOLD &&
          waiterHead * 2 >= waiters.length
        ) {
          // Reclaim consumed slots occasionally to keep dequeue amortized O(1).
          waiters.splice(0, waiterHead);
          waiterHead = 0;
        }
        next();
      } else {
        active -= 1;
      }
    }
  };
}
