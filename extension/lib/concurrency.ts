export function createLimiter(max: number) {
  let inFlight = 0;
  const waiting: Array<() => void> = [];

  async function run<T>(task: () => Promise<T>): Promise<T> {
    if (inFlight >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    inFlight++;
    try {
      return await task();
    } finally {
      inFlight--;
      waiting.shift()?.();
    }
  }

  return { run };
}
