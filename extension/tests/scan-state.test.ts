import { describe, expect, it } from 'vitest';
import { createScanState } from '../lib/scan-state';

const node = (): object => ({});
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('scan state', () => {
  it('rejects a second submission of the same node and post while in flight', () => {
    const scan = createScanState();
    const el = node();

    const ticket = scan.begin(el, 'p1');
    expect(ticket).not.toBeNull();
    // The MutationObserver fires for every DOM change, including our own mount.
    expect(scan.begin(el, 'p1')).toBeNull();

    scan.end(el, ticket!);
    expect(scan.begin(el, 'p1')).not.toBeNull();
  });

  it('lets a reused node be scored for its new post', () => {
    const scan = createScanState();
    const el = node();
    const first = scan.begin(el, 'p1')!;
    scan.end(el, first);
    scan.commit(el, 'p1');

    expect(scan.isProcessed(el, 'p1')).toBe(true);
    expect(scan.isProcessed(el, 'p2')).toBe(false);
    expect(scan.begin(el, 'p2')).not.toBeNull();
  });

  it('does not let a stale task clear a newer registration', () => {
    const scan = createScanState();
    const el = node();

    const stale = scan.begin(el, 'p1')!;
    scan.invalidate();
    expect(scan.isCurrent(stale)).toBe(false);

    const fresh = scan.begin(el, 'p1')!;
    expect(fresh.id).not.toBe(stale.id);

    // The task from before the settings change finally finishes.
    scan.end(el, stale);
    expect(scan.begin(el, 'p1')).toBeNull();

    scan.end(el, fresh);
    expect(scan.begin(el, 'p1')).not.toBeNull();
  });

  it('rejects results created before an invalidation', () => {
    const scan = createScanState();
    const el = node();
    const before = scan.begin(el, 'p1')!;

    scan.invalidate();

    expect(scan.isCurrent(before)).toBe(false);
    const after = scan.begin(el, 'p1')!;
    expect(scan.isCurrent(after)).toBe(true);
  });

  it('forgets processed nodes on invalidate', () => {
    const scan = createScanState();
    const el = node();
    scan.commit(el, 'p1');
    expect(scan.isProcessed(el, 'p1')).toBe(true);

    scan.invalidate();

    expect(scan.isProcessed(el, 'p1')).toBe(false);
    expect(scan.generation).toBe(1);
  });
});

describe('scan state with async tasks', () => {
  it('keeps exactly one task per node and post under repeated triggers', async () => {
    const scan = createScanState();
    const el = node();
    let submits = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const submit = async (): Promise<void> => {
      // Mirrors handleArticle: a committed node is not submitted again.
      if (scan.isProcessed(el, 'p1')) return;
      const ticket = scan.begin(el, 'p1');
      if (!ticket) return;
      submits++;
      try {
        await gate;
        if (!scan.isCurrent(ticket)) return;
        scan.commit(el, 'p1');
      } finally {
        scan.end(el, ticket);
      }
    };

    const first = submit();
    // Several scans run while the first score is still in flight.
    await Promise.all([submit(), submit(), submit()]);
    expect(submits).toBe(1);

    release();
    await first;
    await tick();
    expect(scan.isProcessed(el, 'p1')).toBe(true);

    // A later scan sees the committed node and does not score it again.
    await submit();
    expect(submits).toBe(1);
  });

  it('drops an in-flight result when the settings change mid-request', async () => {
    const scan = createScanState();
    const el = node();
    let cacheWrites = 0;
    let rendered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const task = (async () => {
      const ticket = scan.begin(el, 'p1')!;
      try {
        await gate;
        if (!scan.isCurrent(ticket)) return;
        rendered++;
        scan.commit(el, 'p1');
      } finally {
        if (scan.isCurrent(ticket)) cacheWrites++;
        scan.end(el, ticket);
      }
    })();

    // Debug mode flipped on (or the model changed) while the request ran.
    scan.invalidate();
    release();
    await task;

    expect(rendered).toBe(0);
    expect(cacheWrites).toBe(0);
    expect(scan.isProcessed(el, 'p1')).toBe(false);
  });
});
