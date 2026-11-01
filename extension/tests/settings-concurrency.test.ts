import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/types';

vi.mock('wxt/utils/define-background', () => ({ defineBackground: (main: () => void) => ({ main }) }));

afterEach(() => vi.unstubAllGlobals());

describe('cross-page settings writes', () => {
  it('does not let an old legacy read overwrite a newer model opt-out', async () => {
    vi.resetModules();
    const store: Record<string, unknown> = {
      slopShieldSettings: { ...DEFAULT_SETTINGS, apiKey: 'synthetic-key', prefilterOnly: false },
    };
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let firstRead = true;
    vi.stubGlobal('chrome', { storage: { local: {
      get: async () => {
        const snapshot = structuredClone(store);
        if (firstRead) { firstRead = false; started(); await gate; }
        return snapshot;
      },
      set: async (value: Record<string, unknown>) => { Object.assign(store, structuredClone(value)); },
      remove: async (key: string) => { delete store[key]; },
    } } });
    const { loadSettings, saveSettings } = await import('../lib/settings');
    const oldRead = loadSettings();
    await waiting;
    await saveSettings({ prefilterOnly: true });
    release();
    await oldRead;
    expect((await loadSettings()).prefilterOnly).toBe(true);
    expect((await loadSettings()).apiKey).toBe('synthetic-key');
  });

  it('serializes partial updates in the background and rejects untrusted senders', async () => {
    vi.resetModules();
    const store: Record<string, unknown> = {
      antiSlopForXSettings: { ...DEFAULT_SETTINGS, apiKey: 'synthetic-key', prefilterOnly: false, debugMode: false },
    };
    let listener!: (message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean;
    const extensionId = 'synthetic-extension';
    const sender = { id: extensionId, url: `chrome-extension://${extensionId}/options.html` };
    const queryTabs = vi.fn(async () => []);
    vi.stubGlobal('chrome', {
      tabs: { query: queryTabs },
      storage: { local: {
        get: async () => structuredClone(store),
        set: async (value: Record<string, unknown>) => { await Promise.resolve(); Object.assign(store, structuredClone(value)); },
        remove: async () => {},
      } },
      runtime: {
        id: extensionId,
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: (value: typeof listener) => { listener = value; } },
        sendMessage: (message: unknown) => new Promise((resolve) => { listener(message, sender, resolve); }),
      },
    });
    const background = await import('../entrypoints/background');
    background.default.main();
    const { saveSettingsViaBackground, loadSettings } = await import('../lib/settings');
    const keep = new Promise<unknown>((resolve) => {
      listener({ type: 'ANTI_SLOP_KEEP_ACCOUNT', handle: 'kept' },
        { id: extensionId, url: 'https://x.com/home', tab: { id: 1, url: 'https://x.com/home' } }, resolve);
    });
    await Promise.all([
      saveSettingsViaBackground({ prefilterOnly: true }),
      saveSettingsViaBackground({ debugMode: true }),
      keep,
    ]);
    expect(await loadSettings()).toMatchObject({ prefilterOnly: true, debugMode: true, apiKey: 'synthetic-key', accountWhitelist: ['kept'] });

    const rejected = await new Promise<unknown>((resolve) => {
      listener({ type: 'ANTI_SLOP_SAVE_SETTINGS', patch: { prefilterOnly: false } },
        { id: 'other-extension', url: 'https://x.com/' }, resolve);
    });
    expect(rejected).toEqual({ ok: false });
    const invalid = await new Promise<unknown>((resolve) => {
      listener({ type: 'ANTI_SLOP_SAVE_SETTINGS', patch: { credentialRevision: 'forged' } }, sender, resolve);
    });
    expect(invalid).toEqual({ ok: false });
    const listReplacement = await new Promise<unknown>((resolve) => {
      listener({ type: 'ANTI_SLOP_SAVE_SETTINGS', patch: { accountWhitelist: [] } }, sender, resolve);
    });
    expect(listReplacement).toEqual({ ok: false });
    const invalidRuleEdits = await new Promise<unknown>((resolve) => {
      listener({ type: 'ANTI_SLOP_SAVE_SETTINGS', patch: {}, ruleEdits: {
        accountWhitelist: { add: ['kept'], remove: ['@KEPT'] },
      } }, sender, resolve);
    });
    expect(invalidRuleEdits).toEqual({ ok: false });
    expect((await loadSettings()).accountWhitelist).toEqual(['kept']);
    expect((await loadSettings()).prefilterOnly).toBe(true);

    const { requestFingerprint } = await import('../lib/scorer');
    const basis = requestFingerprint(await loadSettings());
    await saveSettingsViaBackground({ apiKey: 'rotated-synthetic-key' }, basis);
    await expect(saveSettingsViaBackground({ endpointPreset: 'openai-responses' }, basis)).rejects.toThrow('stale');
    expect((await loadSettings()).endpointPreset).toBe(DEFAULT_SETTINGS.endpointPreset);

    const undoFromContent = await new Promise<unknown>((resolve) => {
      listener({ type: 'ANTI_SLOP_UNDO_BLOCK', handle: 'kept', ts: 123 },
        { id: extensionId, url: 'https://x.com/home', tab: { id: 1, url: 'https://x.com/home' } }, resolve);
    });
    expect(undoFromContent).toEqual({ ok: false });
    expect(queryTabs).not.toHaveBeenCalled();
    const undoFromPopup = await new Promise<unknown>((resolve) => {
      listener({ type: 'ANTI_SLOP_UNDO_BLOCK', handle: 'kept', ts: 123 },
        { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` }, resolve);
    });
    expect(undoFromPopup).toEqual({ ok: false, error: 'no-x-tab' });
    expect(queryTabs).toHaveBeenCalledOnce();
  });
});
