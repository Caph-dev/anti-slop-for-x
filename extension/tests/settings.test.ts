import { describe, expect, it } from 'vitest';
import {
  loadSettings,
  recognitionSettingsChanged,
  saveSettings,
  settingsKey,
} from '../lib/settings';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';
import { DEFAULT_PROMPT } from '../lib/prompt';
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

  it('reads legacy settings without writing, then migrates them on the next queued save', async () => {
    const store = installChrome({
      slopShieldSettings: { threshold: 0.8, apiKey: 'kept-key', accountWhitelist: ['alice'] },
    });

    const loaded = await loadSettings();

    expect(loaded.threshold).toBe(0.8);
    expect(loaded.apiKey).toBe('kept-key');
    expect(loaded.accountWhitelist).toEqual(['alice']);
    expect(loaded.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(store.antiSlopForXSettings).toBeUndefined();
    expect(store.slopShieldSettings).toBeDefined();

    await saveSettings({});
    expect(store.antiSlopForXSettings).toMatchObject({
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
    expect(store.slopShieldSettings).toEqual({ apiKey: 'old' });
    await saveSettings({});
    expect(store.slopShieldSettings).toBeUndefined();
    expect(store.antiSlopForXSettings).toMatchObject({ apiKey: 'new' });
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

  it('reads stored strict and auto-fold modes as shadow while folding is unavailable', async () => {
    for (const stored of ['strict', 'auto-fold'] as const) {
      const store = installChrome({ antiSlopForXSettings: { scanMode: stored } });

      const loaded = await loadSettings();

      expect(loaded.scanMode).toBe('shadow');
      // The effective mode changes; what is stored does not, so a future
      // independently reviewed change can restore the user's choice.
      expect(store.antiSlopForXSettings).toEqual({ scanMode: stored });
    }

    installChrome({ antiSlopForXSettings: { scanMode: 'manual' } });
    expect((await loadSettings()).scanMode).toBe('manual');
  });

  it('defaults debug mode off, including for settings saved before it existed', async () => {
    installChrome({});
    expect((await loadSettings()).debugMode).toBe(false);

    installChrome({ antiSlopForXSettings: { threshold: 0.7 } });
    const loaded = await loadSettings();
    expect(loaded.debugMode).toBe(false);
    expect(loaded.threshold).toBe(0.7);
  });

  it('persists the debug toggle', async () => {
    const store = installChrome({});
    const saved = await saveSettings({ debugMode: true });
    expect(saved.debugMode).toBe(true);
    expect((store.antiSlopForXSettings as { debugMode?: boolean }).debugMode).toBe(true);
    expect((await loadSettings()).debugMode).toBe(true);
  });

  it('upgrades a stored prompt that is only the old shipped default', async () => {
    installChrome({
      antiSlopForXSettings: {
        defaultPrompt: 'does this look like AI engagement bait / bot reply on X',
      },
    });

    const loaded = await loadSettings();

    // The field was never edited, so prompt fixes must reach the user.
    expect(loaded.defaultPrompt).toBe(DEFAULT_PROMPT);
    expect(loaded.defaultPrompt).not.toContain('does this look like AI engagement bait');
  });

  it('never overwrites a prompt the user wrote', async () => {
    installChrome({ antiSlopForXSettings: { defaultPrompt: 'Flag only hype-y reply guys.' } });

    expect((await loadSettings()).defaultPrompt).toBe('Flag only hype-y reply guys.');
  });

  it('keeps an empty prompt empty (the adapters fall back to the default)', async () => {
    installChrome({ antiSlopForXSettings: { defaultPrompt: '   ' } });

    // Only the shipped one-liner is upgraded; an emptied field stays emptied so
    // the options page shows what the user actually stored.
    expect((await loadSettings()).defaultPrompt).toBe('   ');
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

  it('never infers the Responses protocol from stored settings', async () => {
    installChrome({
      antiSlopForXSettings: {
        upstreamBaseUrl: 'https://api.openai.com/v1',
        protocol: 'openai-responses',
        upstreamPath: '/responses',
        model: 'test-model',
      },
    });

    const loaded = await loadSettings();

    // The (custom) preset is not inferred; the protocol only stays Responses
    // because the stored legacy fields already said so. Importing an old
    // settings object never starts a new protocol by itself.
    expect(loaded.endpointPreset).toBe('custom');
    expect(resolveEndpoint(loaded).protocol).toBe('openai-responses');
  });
});

describe('legacy preferences', () => {
  it('keeps the pre-0.10 short-text no-send preference for stored settings', async () => {
    installChrome({ antiSlopForXSettings: { apiKey: 'stored-key' } });
    expect((await loadSettings()).skipShortText).toBe(true);

    installChrome({});
    expect((await loadSettings()).skipShortText).toBe(false);
  });

  it('keeps an explicit short-text choice, including turning it off', async () => {
    installChrome({ antiSlopForXSettings: { skipShortText: false, shortTextMaxChars: 30 } });
    const loaded = await loadSettings();
    expect(loaded.skipShortText).toBe(false);
    expect(loaded.shortTextMaxChars).toBe(30);
  });

  it('keeps the legacy threshold stored without using it for recognition', async () => {
    const store = installChrome({ antiSlopForXSettings: { threshold: 0.9 } });

    expect((await loadSettings()).threshold).toBe(0.9);
    await saveSettings({ threshold: 0.9 });
    expect(store.antiSlopForXSettings).toMatchObject({ threshold: 0.9 });
  });

  it('keeps the model-use opt-out across a save', async () => {
    installChrome({ antiSlopForXSettings: { prefilterOnly: true } });
    expect((await loadSettings()).prefilterOnly).toBe(true);
    expect((await saveSettings({ model: 'test-model' })).prefilterOnly).toBe(true);
  });
});

describe('recognition identity guards', () => {
  it('ignores edits that only change admission or presentation', () => {
    const next: Settings = {
      ...DEFAULT_SETTINGS,
      enabled: false,
      autoScan: false,
      scanMode: 'manual',
      scanScope: 'timeline-and-replies',
      threshold: 0.8,
      maxConcurrency: 8,
      debugMode: true,
      prefilterOnly: true,
      skipShortText: true,
      shortTextMaxChars: 20,
      skipOwnPosts: false,
      accountWhitelist: ['alice'],
      accountHideList: ['bob'],
      defaultPrompt: 'another prompt',
    };
    // These are re-evaluated on every render, so they leave the recognition
    // fingerprint (what a request contains and where it goes) unchanged.
    expect(recognitionSettingsChanged(DEFAULT_SETTINGS, next)).toBe(false);
    expect(recognitionSettingsChanged(next, DEFAULT_SETTINGS)).toBe(false);
  });

  it('detects edits that change what a request contains or where it goes', () => {
    const edits: Array<Partial<Settings>> = [
      { apiKey: 'k' },
      { credentialRevision: 1 },
      { model: 'other-model' },
      { protocol: 'openai-decisions' },
      { endpointPreset: 'custom' },
      { upstreamBaseUrl: 'https://gateway.example.com/v1' },
      { upstreamPath: '/decide' },
    ];
    for (const edit of edits) {
      expect(recognitionSettingsChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, ...edit })).toBe(true);
      expect(recognitionSettingsChanged({ ...DEFAULT_SETTINGS, ...edit }, DEFAULT_SETTINGS)).toBe(true);
    }
  });

  it('changes the credential revision only when the key changes', async () => {
    const store = installChrome({});
    const first = await saveSettings({ apiKey: 'first-key' });
    expect(first.credentialRevision).not.toBe(DEFAULT_SETTINGS.credentialRevision);

    expect((await saveSettings({ apiKey: 'first-key' })).credentialRevision).toBe(first.credentialRevision);
    expect((await saveSettings({ model: 'other-model', debugMode: true })).credentialRevision).toBe(first.credentialRevision);

    const rotated = await saveSettings({ apiKey: 'second-key' });
    expect(rotated.credentialRevision).not.toBe(first.credentialRevision);
    expect((store.antiSlopForXSettings as { credentialRevision?: number | string }).credentialRevision).toBe(rotated.credentialRevision);
    expect((await loadSettings()).credentialRevision).toBe(rotated.credentialRevision);
  });
});
