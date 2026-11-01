import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

const mocks = vi.hoisted(() => ({
  contains: vi.fn(),
  sendMessage: vi.fn(),
  current: null as unknown as Settings,
  storageListener: null as unknown as (...args: unknown[]) => void,
}));

vi.mock('../lib/settings', () => ({
  loadSettings: async () => ({ ...mocks.current }),
  saveSettingsViaBackground: vi.fn(),
  settingsKey: () => 'antiSlopForXSettings',
}));
vi.mock('../lib/action-log', () => ({
  readActionLog: async () => [],
  clearActionLog: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.current = {
    ...DEFAULT_SETTINGS, endpointPreset: 'custom', protocol: 'openai-responses',
    upstreamBaseUrl: 'https://example.test/v1', upstreamPath: '/responses',
    apiKey: 'synthetic-key', model: 'synthetic-model', prefilterOnly: false,
  };
  mocks.contains.mockResolvedValue(false);
  mocks.sendMessage.mockResolvedValue({ ok: true, scanned: 1 });
});
afterEach(() => vi.unstubAllGlobals());

describe('popup host access', () => {
  it('shows missing access even after a scan returns a count', async () => {
    const html = readFileSync(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');
    const { document, window } = parseHTML(html);
    for (const select of Array.from(document.querySelectorAll('select'))) {
      let value = select.querySelector('option')?.getAttribute('value') ?? '';
      Object.defineProperty(select, 'value', { configurable: true, get: () => value, set: (next: string) => { value = next; } });
    }
    vi.stubGlobal('document', document);
    vi.stubGlobal('navigator', { language: 'en' });
    vi.stubGlobal('chrome', {
      permissions: { contains: mocks.contains },
      storage: { onChanged: { addListener: (listener: (...args: unknown[]) => void) => { mocks.storageListener = listener; } } },
      runtime: { getManifest: () => ({ version: '0.0.0' }), openOptionsPage: vi.fn() },
      tabs: { query: async () => [{ id: 1, url: 'https://x.com/home' }], sendMessage: mocks.sendMessage },
    });
    await import('../entrypoints/popup/main');
    await vi.waitFor(() => expect(document.querySelector('#connectionDetail')?.textContent).toContain('host access'));
    document.querySelector('#scan')!.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    await vi.waitFor(() => expect(document.querySelector('#note')?.textContent).toContain('host access'));
    expect(document.querySelector('#note')?.textContent).not.toContain('Checked 1 post');
    mocks.current = { ...mocks.current, prefilterOnly: true };
    mocks.storageListener({ antiSlopForXSettings: {} }, 'local');
    await vi.waitFor(() => expect(document.querySelector('#note')?.textContent).toContain('Model use is off'));
  });
});
