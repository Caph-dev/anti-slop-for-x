import { describe, expect, it } from 'vitest';
import {
  ACTION_LOG_LIMIT,
  clearActionLog,
  logAutoAction,
  markActionUndone,
  readActionLog,
  type AutoActionEntry,
} from '../lib/action-log';

type Store = Record<string, unknown>;

function installChrome(initial: Store = {}): Store {
  const store: Store = { ...initial };
  const chromeMock = {
    storage: {
      local: {
        async get(keys: string | string[]) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Store = {};
          for (const key of list) if (key in store) out[key] = store[key];
          return out;
        },
        async set(items: Store) {
          Object.assign(store, items);
        },
      },
    },
  };
  (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
  return store;
}

function entry(n: number): AutoActionEntry {
  return {
    ts: 1_700_000_000_000 + n,
    action: 'block',
    handle: `user${n}`,
    postId: String(n),
    score: 0.95,
    ok: true,
  };
}

describe('auto action log', () => {
  it('starts empty', async () => {
    installChrome();
    expect(await readActionLog()).toEqual([]);
  });

  it('keeps newest first', async () => {
    const store = installChrome();
    await logAutoAction(entry(1));
    await logAutoAction(entry(2));

    const log = await readActionLog();
    expect(log.map((e) => e.handle)).toEqual(['user2', 'user1']);
    expect(store[actionLogKey()]).toBeDefined();
  });

  it('caps the log at the limit', async () => {
    installChrome();
    for (let i = 0; i < ACTION_LOG_LIMIT + 5; i += 1) await logAutoAction(entry(i));

    const log = await readActionLog();
    expect(log).toHaveLength(ACTION_LOG_LIMIT);
    expect(log[0].handle).toBe(`user${ACTION_LOG_LIMIT + 4}`);
  });

  it('ignores a corrupted stored value', async () => {
    installChrome({ antiSlopActionLog: 'nope' });
    expect(await readActionLog()).toEqual([]);
  });

  it('marks exactly the matching entry as undone', async () => {
    installChrome();
    await logAutoAction(entry(1));
    await logAutoAction(entry(2));

    await markActionUndone(entry(1).ts, entry(1).handle);

    const log = await readActionLog();
    expect(log.find((e) => e.handle === 'user1')?.undone).toBe(true);
    expect(log.find((e) => e.handle === 'user2')?.undone).toBeUndefined();
  });

  it('does nothing when the entry is gone', async () => {
    installChrome();
    await logAutoAction(entry(1));
    await markActionUndone(999, 'ghost');
    expect((await readActionLog())[0].undone).toBeUndefined();
  });

  it('clears', async () => {
    installChrome();
    await logAutoAction(entry(1));
    await clearActionLog();
    expect(await readActionLog()).toEqual([]);
  });
});

// Imported late so the helper above stays readable.
import { actionLogKey } from '../lib/action-log';
