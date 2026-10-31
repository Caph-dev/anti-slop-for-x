import { describe, expect, it } from 'vitest';
import { createLimiter } from '../lib/concurrency';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createLimiter', () => {
  it('runs no more than the cap at once', async () => {
    const limiter = createLimiter(2);
    const gate = deferred();
    let active = 0;
    let peak = 0;

    const task = (): Promise<void> =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
      });

    const all = [task(), task(), task(), task()];
    await tick();
    expect(active).toBe(2);
    expect(peak).toBe(2);

    gate.resolve();
    await Promise.all(all);
    expect(active).toBe(0);
    expect(peak).toBe(2);
  });

  it('starts queued tasks when the cap is raised in place', async () => {
    const limiter = createLimiter(1);
    const gate = deferred();
    let active = 0;
    let peak = 0;

    const task = (): Promise<void> =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
      });

    const all = [task(), task(), task()];
    await tick();
    expect(peak).toBe(1);

    // Changing maxConcurrency must grow the same queue, not build a second one.
    limiter.setMax(3);
    await tick();
    expect(peak).toBe(3);
    expect(active).toBe(3);

    gate.resolve();
    await Promise.all(all);
    expect(active).toBe(0);
  });

  it('stops starting queued tasks when the cap is lowered', async () => {
    const limiter = createLimiter(3);
    const gates = [deferred(), deferred(), deferred(), deferred(), deferred()];
    let started = 0;
    let active = 0;

    const all = gates.map((gate) =>
      limiter.run(async () => {
        started++;
        active++;
        await gate.promise;
        active--;
      }),
    );

    await tick();
    expect(started).toBe(3);

    // Lowering the cap never starts anything; it only withholds new starts
    // until the number of running tasks is back under it.
    limiter.setMax(1);
    await tick();
    expect(started).toBe(3);

    gates[0].resolve();
    await tick();
    expect(active).toBe(2);
    expect(started).toBe(3);

    gates[1].resolve();
    await tick();
    expect(active).toBe(1);
    expect(started).toBe(3);

    gates[2].resolve();
    await tick();
    expect(started).toBe(4);
    expect(active).toBe(1);

    gates[3].resolve();
    await tick();
    expect(started).toBe(5);

    gates[4].resolve();
    await Promise.all(all);
    expect(active).toBe(0);
  });

  it('normalises a non-positive cap to one', async () => {
    const limiter = createLimiter(0);
    const gate = deferred();
    let active = 0;
    let peak = 0;

    const task = (): Promise<void> =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
      });

    const all = [task(), task()];
    await tick();
    expect(peak).toBe(1);

    gate.resolve();
    await Promise.all(all);
  });
});
