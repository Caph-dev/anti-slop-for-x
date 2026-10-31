export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Change the concurrency cap in place; queued tasks start as slots free up. */
  setMax(max: number): void;
}

function normalizeMax(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

/**
 * A single limiter object lives for the whole session: rebuilding it while
 * tasks are queued would put two independent caps side by side and exceed the
 * concurrency the settings promise. `setMax` re-uses the same queue instead.
 */
export function createLimiter(initialMax: number): Limiter {
  let max = normalizeMax(initialMax);
  let inFlight = 0;
  const waiting: Array<() => void> = [];

  /** Hand free slots to waiters. A woken task keeps the slot it is given. */
  function handOffSlots(): void {
    while (inFlight < max && waiting.length > 0) {
      const resolve = waiting.shift()!;
      inFlight++;
      resolve();
    }
  }

  function acquire(): Promise<void> {
    if (inFlight < max) {
      inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        inFlight--;
        handOffSlots();
      }
    },

    setMax(next: number): void {
      max = normalizeMax(next);
      handOffSlots();
    },
  };
}
