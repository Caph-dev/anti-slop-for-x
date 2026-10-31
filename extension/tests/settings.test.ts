import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings, settingsKey } from '../lib/settings';
import { DEFAULT_SETTINGS } from '../lib/types';
import { ENDPOINT_PRESETS, resolveEndpoint } from '../lib/endpoints';
import { resolveUpstreamPath } from '../lib/adapters';

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

  it('infers an endpoint preset for settings saved before presets existed', async () => {
    installChrome({
      antiSlopForXSettings: {
        upstreamBaseUrl: 'https://gateway.example.com/v1',
        upstreamPath: '/decide',
        protocol: 'jev',
      },
    });

    const loaded = await loadSettings();

    expect(loaded.endpointPreset).toBe('custom');
    expect(loaded.upstreamBaseUrl).toBe('https://gateway.example.com/v1');
  });

  it('defaults to the Jev preset when nothing is stored', async () => {
    installChrome({});
    const loaded = await loadSettings();
    expect(loaded.endpointPreset).toBe('jev-official');
  });

  it('keeps a custom model when legacy settings map to a preset', async () => {
    installChrome({
      antiSlopForXSettings: {
        upstreamBaseUrl: 'https://api.typesafe.ai/v1',
        protocol: 'jev',
        model: 'my-model',
      },
    });

    const loaded = await loadSettings();
    const endpoint = resolveEndpoint(loaded);

    expect(loaded.endpointPreset).toBe('jev-official');
    expect(endpoint.model).toBe('my-model');
    expect(endpoint.baseUrl).toBe(ENDPOINT_PRESETS['jev-official'].baseUrl);
  });

  it('keeps the URL identical when a legacy Jev settings object has no path', async () => {
    installChrome({
      antiSlopForXSettings: { upstreamBaseUrl: 'https://api.typesafe.ai/v1', protocol: 'jev' },
    });

    const loaded = await loadSettings();

    expect(loaded.endpointPreset).toBe('jev-official');
    expect(resolveUpstreamPath(loaded)).toBe(ENDPOINT_PRESETS['jev-official'].path);
    expect(resolveEndpoint(loaded).path).toBe(ENDPOINT_PRESETS['jev-official'].path);
  });

  it('does not repoint an OpenAI base URL that had no explicit path', async () => {
    installChrome({
      antiSlopForXSettings: {
        upstreamBaseUrl: 'https://api.openai.com/v1',
        protocol: 'openai-decisions',
      },
    });

    const loaded = await loadSettings();

    // Before presets this resolved to /systemone (the default path), so the
    // migration must not silently switch it to /decisions.
    expect(loaded.endpointPreset).toBe('custom');
    expect(resolveEndpoint(loaded).path).toBe('/systemone');
  });

  it('maps an OpenAI base URL with the explicit /decisions path to the preset', async () => {
    installChrome({
      antiSlopForXSettings: {
        upstreamBaseUrl: 'https://api.openai.com/v1',
        protocol: 'openai-decisions',
        upstreamPath: '/decisions',
      },
    });

    const loaded = await loadSettings();

    expect(loaded.endpointPreset).toBe('openai-official');
    expect(resolveEndpoint(loaded).path).toBe('/decisions');
  });
});
