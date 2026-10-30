import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings, settingsKey } from '../lib/settings';
import { DEFAULT_SETTINGS } from '../lib/types';

type Store = Record<string, unknown>;

function installChrome(initial: Store): Store {
  const store: Store = { ...initial };
  const chromeMock = {
    storage: {
      local: {
        async get(keys: string | string[]) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Store = {};
          for (const key of list) {
            if (key in store) out[key] = store[key];
          }
          return out;
        },
        async set(items: Store) {
          Object.assign(store, items);
        },
        async remove(key: string) {
          delete store[key];
        },
      },
    },
  };
  (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
  return store;
}

describe('settings storage', () => {
  it('uses the Anti Slop for X key', () => {
    expect(settingsKey()).toBe('antiSlopForXSettings');
  });

  it('migrates slopShieldSettings once without dropping values', async () => {
    const store = installChrome({
      slopShieldSettings: { threshold: 0.8, apiKey: 'kept-key', accountWhitelist: ['alice'] },
    });

    const loaded = await loadSettings();

    expect(loaded.threshold).toBe(0.8);
    expect(loaded.apiKey).toBe('kept-key');
    expect(loaded.accountWhitelist).toEqual(['alice']);
    expect(loaded.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(store.antiSlopForXSettings).toEqual({
      threshold: 0.8,
      apiKey: 'kept-key',
      accountWhitelist: ['alice'],
    });
    expect(store.slopShieldSettings).toBeUndefined();

    const again = await loadSettings();
    expect(again.apiKey).toBe('kept-key');
    expect(store.slopShieldSettings).toBeUndefined();
  });

  it('keeps the new key when both keys exist', async () => {
    const store = installChrome({
      antiSlopForXSettings: { apiKey: 'new' },
      slopShieldSettings: { apiKey: 'old' },
    });

    const loaded = await loadSettings();

    expect(loaded.apiKey).toBe('new');
    expect(store.slopShieldSettings).toBeUndefined();
    expect(store.antiSlopForXSettings).toEqual({ apiKey: 'new' });
  });

  it('saves under the new key', async () => {
    const store = installChrome({});
    const saved = await saveSettings({ threshold: 0.42 });
    expect(saved.threshold).toBe(0.42);
    expect(store.antiSlopForXSettings).toMatchObject({ threshold: 0.42 });
    expect(store.slopShieldSettings).toBeUndefined();
  });
});
