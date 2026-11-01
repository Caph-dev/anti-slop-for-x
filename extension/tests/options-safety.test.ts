import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

const mocks = vi.hoisted(() => ({
  current: null as unknown as Settings,
  save: vi.fn(),
  permission: vi.fn(),
  access: vi.fn(),
  recognize: vi.fn(),
  confirm: vi.fn(),
  storageListener: null as null | ((changes: Record<string, unknown>, area: string) => void),
}));

vi.mock('../lib/settings', () => ({
  loadSettings: async () => ({ ...mocks.current }),
  saveSettingsViaBackground: mocks.save,
  settingsKey: () => 'antiSlopForXSettings',
}));
vi.mock('../lib/permissions', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/permissions')>(),
  requestOriginAccess: mocks.permission,
  hasOriginAccess: mocks.access,
}));
vi.mock('../lib/recognizer-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/recognizer-client')>(),
  recognizeUpstream: mocks.recognize,
}));

async function openOptions(overrides: Partial<Settings> = {}) {
  mocks.current = {
    ...DEFAULT_SETTINGS,
    endpointPreset: 'custom',
    protocol: 'openai-responses',
    upstreamBaseUrl: 'https://first.example.test/v1',
    upstreamPath: '/responses',
    model: 'synthetic-model',
    apiKey: 'synthetic-key',
    ...overrides,
  };
  const html = readFileSync(new URL('../entrypoints/options/index.html', import.meta.url), 'utf8');
  const { document, window } = parseHTML(html);
  for (const select of Array.from(document.querySelectorAll('select'))) {
    let value = select.querySelector('option')?.getAttribute('value') ?? '';
    Object.defineProperty(select, 'value', {
      configurable: true,
      get: () => value,
      set: (next: string) => { value = next; },
    });
  }
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { language: 'en' });
  vi.stubGlobal('window', { confirm: mocks.confirm });
  vi.stubGlobal('chrome', { storage: { onChanged: {
    addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => { mocks.storageListener = listener; },
  } } });
  await import('../entrypoints/options/main');
  await vi.waitFor(() => expect((document.querySelector('#apiKey') as unknown as HTMLInputElement).value).toBe('synthetic-key'));
  return { document, window };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.storageListener = null;
  mocks.confirm.mockReturnValue(false);
  mocks.permission.mockResolvedValue(true);
  mocks.access.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());

describe('options data boundary', () => {
  it.each(['enabled', 'prefilterOnly'])('does not claim unsaved %s changes are active', async (field) => {
    const { document, window } = await openOptions();
    const input = document.querySelector(`#${field}`) as unknown as HTMLInputElement;
    input.checked = !input.checked;
    input.dispatchEvent(new window.Event('change'));
    expect(document.querySelector('#endpointStatus')?.textContent).toContain('Unsaved');
    expect(document.querySelector('#endpointStatus')?.textContent).not.toContain('Nothing is sent');
  });

  it('reconciles a delayed storage echo of its own save', async () => {
    mocks.save.mockImplementation(async (patch: Partial<Settings>) => {
      mocks.current = { ...mocks.current, ...patch };
      return mocks.current;
    });
    const { document, window } = await openOptions();
    (document.querySelector('#enabled') as unknown as HTMLInputElement).checked = false;
    document.querySelector('#save')!.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toBe('Saved'));
    mocks.storageListener!({ antiSlopForXSettings: {} }, 'local');
    await vi.waitFor(() => expect(document.querySelector('#endpointStatus')?.textContent).toContain('disabled'));
  });

  it('does not send duplicate connection tests on repeated clicks', async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.recognize.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { document, window } = await openOptions();
    const button = document.querySelector('#test')!;
    button.dispatchEvent(new window.Event('click'));
    button.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalled());
    const attempts = mocks.recognize.mock.calls.length;
    expect((button as unknown as HTMLButtonElement).disabled).toBe(true);
    pending.forEach((resolve) => resolve({ status: 'failed', error: 'network', context: {} }));
    await vi.waitFor(() => expect((button as unknown as HTMLButtonElement).disabled).toBe(false));
    expect(attempts).toBe(1);
  });

  it('does not show a stale connection result after the extension is disabled', async () => {
    let release!: (value: unknown) => void;
    mocks.recognize.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    mocks.save.mockImplementation(async (patch: Partial<Settings>) => {
      mocks.current = { ...mocks.current, ...patch };
      mocks.storageListener?.({ antiSlopForXSettings: {} }, 'local');
      return mocks.current;
    });
    const { document, window } = await openOptions();
    document.querySelector('#test')!.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalledOnce());
    const enabled = document.querySelector('#enabled') as unknown as HTMLInputElement;
    enabled.checked = false;
    enabled.dispatchEvent(new window.Event('change'));
    document.querySelector('#save')!.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toBe('Saved'));
    release({ status: 'classified', category: 'normal', reason: 'Synthetic', evidence: [], counterevidence: [], context: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('#status')?.textContent).toBe('Saved');
  });

  it('clears the testing status when a model edit invalidates a pending result', async () => {
    let release!: (value: unknown) => void;
    mocks.recognize.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const { document, window } = await openOptions();
    const button = document.querySelector('#test')!;
    button.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalledOnce());
    const model = document.querySelector('#model') as unknown as HTMLInputElement;
    model.value = 'new-model';
    model.dispatchEvent(new window.Event('input'));
    release({ status: 'classified', category: 'normal', reason: 'Synthetic', evidence: [], counterevidence: [], context: {} });
    await vi.waitFor(() => expect((button as unknown as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelector('#status')?.textContent).toContain('Settings changed');
  });

  it('re-enables the connection test after a normal response', async () => {
    mocks.recognize.mockResolvedValueOnce({ status: 'failed', error: 'network', context: {} });
    const { document, window } = await openOptions();
    const button = document.querySelector('#test')!;
    button.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Request failed'));
    expect((button as unknown as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  it('saves settings and reports a synchronous host permission error', async () => {
    mocks.permission.mockImplementationOnce(() => { throw new Error('synthetic permission failure'); });
    mocks.save.mockImplementation(async (patch: Partial<Settings>) => {
      mocks.current = { ...mocks.current, ...patch };
      return mocks.current;
    });
    const { document, window } = await openOptions();
    const model = document.querySelector('#model') as unknown as HTMLInputElement;
    model.value = 'changed-model';
    document.querySelector('#save')!.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('denied'));
    expect(mocks.current.model).toBe('changed-model');
    expect((document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false);
  });

  it('re-enables the connection test if requesting permission throws', async () => {
    mocks.permission.mockImplementationOnce(() => { throw new Error('synthetic permission failure'); });
    const { document, window } = await openOptions();
    const button = document.querySelector('#test')!;
    button.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('denied'));
    expect((button as unknown as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the saved switch state after the background confirms the change', async () => {
    mocks.save.mockImplementation(async (patch: Partial<Settings>) => {
      mocks.current = { ...mocks.current, ...patch };
      mocks.storageListener?.({ antiSlopForXSettings: {} }, 'local');
      return mocks.current;
    });
    const { document, window } = await openOptions();
    const enabled = document.querySelector('#enabled') as unknown as HTMLInputElement;
    enabled.checked = false;
    enabled.dispatchEvent(new window.Event('change'));
    expect(document.querySelector('#endpointStatus')?.textContent).toContain('Unsaved');
    document.querySelector('#save')!.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(document.querySelector('#endpointStatus')?.textContent).toContain('disabled'));
    expect(mocks.current.enabled).toBe(false);
  });

  it('keeps the unsaved warning when an older permission check returns', async () => {
    let release!: (value: boolean) => void;
    mocks.access.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }));
    const { document, window } = await openOptions();
    const enabled = document.querySelector('#enabled') as unknown as HTMLInputElement;
    enabled.checked = false;
    enabled.dispatchEvent(new window.Event('change'));
    release(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('#endpointStatus')?.textContent).toContain('Unsaved');
  });

  it('marks the form stale when another extension page changes stored settings', async () => {
    const { document } = await openOptions();
    mocks.current = { ...mocks.current, enabled: false };
    expect(mocks.storageListener).not.toBeNull();
    mocks.storageListener!({ antiSlopForXSettings: {} }, 'local');
    expect(document.querySelector('#endpointStatus')?.textContent).toContain('changed');
  });

  it('shows missing host access instead of claiming requests can be sent', async () => {
    mocks.access.mockResolvedValue(false);
    const { document } = await openOptions();
    await vi.waitFor(() => expect(document.querySelector('#endpointStatus')?.textContent).toContain('host access'));
    expect(document.querySelector('#endpointStatus')?.classList.contains('warn')).toBe(true);
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer opt-out with an untouched stale form value', async () => {
    mocks.save.mockImplementation(async (patch: Partial<Settings>) => ({ ...mocks.current, ...patch }));
    const { document, window } = await openOptions();
    mocks.current = { ...mocks.current, prefilterOnly: true };
    (document.querySelector('#model') as unknown as HTMLInputElement).value = 'changed-model';
    document.querySelector('#save')!.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const patch = mocks.save.mock.calls[0][0] as Partial<Settings>;
    expect(patch.model).toBe('changed-model');
    expect(patch).not.toHaveProperty('prefilterOnly');
  });

  it('saves the model opt-out through the background writer', async () => {
    mocks.save.mockImplementation(async (patch: Partial<Settings>) => ({ ...mocks.current, ...patch }));
    const { document, window } = await openOptions();
    (document.querySelector('#prefilterOnly') as unknown as HTMLInputElement).checked = true;
    document.querySelector('#save')!.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ prefilterOnly: true }), expect.any(String), {}));
    expect(mocks.permission).not.toHaveBeenCalled();
  });

  it('does not test a connection while the extension is disabled', async () => {
    const { document, window } = await openOptions({ enabled: false });
    document.querySelector('#test')!.dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.recognize).not.toHaveBeenCalled();
    expect(document.querySelector('#status')?.textContent).toContain('disabled');
  });

  it('requires the enabled switch to be saved before testing', async () => {
    const { document, window } = await openOptions({ enabled: false });
    (document.querySelector('#enabled') as unknown as HTMLInputElement).checked = true;
    document.querySelector('#test')!.dispatchEvent(new window.Event('click'));
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.recognize).not.toHaveBeenCalled();
    expect(document.querySelector('#status')?.textContent).toContain('disabled');
  });

  it('does not request host access when saving with the extension disabled', async () => {
    mocks.save.mockImplementation(async (patch: Partial<Settings>) => ({ ...mocks.current, ...patch }));
    const { document, window } = await openOptions({ enabled: false });
    document.querySelector('#save')!.dispatchEvent(new window.Event('click'));
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.permission).not.toHaveBeenCalled();
  });

  it('rechecks the enabled switch after a pending permission request', async () => {
    let release!: (value: boolean) => void;
    mocks.permission.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }));
    const { document, window } = await openOptions();
    document.querySelector('#test')!.dispatchEvent(new window.Event('click'));
    expect(mocks.permission).toHaveBeenCalledOnce();
    mocks.current = { ...mocks.current, enabled: false };
    release(true);
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('disabled'));
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it('never tests a connection while the stored model opt-out is enabled', async () => {
    const { document, window } = await openOptions({ prefilterOnly: true });
    document.querySelector('#test')!.dispatchEvent(new window.Event('click'));
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.recognize).not.toHaveBeenCalled();
    expect(document.querySelector('#status')?.textContent).toContain('Model use is off');
  });

  it('requires confirmation before reusing a key at a different origin', async () => {
    const { document, window } = await openOptions();
    const url = document.querySelector('#upstreamBaseUrl') as unknown as HTMLInputElement;
    url.value = 'https://second.example.test/v1';
    url.dispatchEvent(new window.Event('input'));
    document.querySelector('#test')!.dispatchEvent(new window.Event('click'));
    document.querySelector('#save')!.dispatchEvent(new window.Event('click'));
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.recognize).not.toHaveBeenCalled();
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('rejects a connection test if the credential changes after confirming a new origin', async () => {
    let release!: (value: boolean) => void;
    mocks.permission.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }));
    mocks.confirm.mockReturnValue(true);
    const { document, window } = await openOptions();
    (document.querySelector('#upstreamBaseUrl') as unknown as HTMLInputElement).value = 'https://second.example.test/v1';
    document.querySelector('#test')!.dispatchEvent(new window.Event('click'));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.permission).toHaveBeenCalledOnce();
    mocks.current = { ...mocks.current, apiKey: 'rotated-synthetic-key' };
    release(true);
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Settings changed'));
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it('rechecks the stored opt-out after a pending permission request', async () => {
    let release!: (value: boolean) => void;
    let notify!: () => void;
    const ready = new Promise<void>((resolve) => { notify = resolve; });
    mocks.permission.mockImplementationOnce(() => {
      notify();
      return new Promise<boolean>((resolve) => { release = resolve; });
    });
    const { document, window } = await openOptions();
    document.querySelector('#test')!.dispatchEvent(new window.Event('click'));
    await ready;
    mocks.current = { ...mocks.current, prefilterOnly: true };
    release(true);
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Model use is off'));
    expect(mocks.recognize).not.toHaveBeenCalled();
  });
});
