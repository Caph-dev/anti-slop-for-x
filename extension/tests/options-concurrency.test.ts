import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

vi.mock('wxt/utils/define-background', () => ({ defineBackground: (main: () => void) => ({ main }) }));

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.resetModules());

async function openOptions(overrides: Partial<Settings> = {}) {
  const initial: Settings = {
    ...DEFAULT_SETTINGS, endpointPreset: 'custom', protocol: 'openai-responses',
    upstreamBaseUrl: 'https://example.test/v1', upstreamPath: '/responses',
    apiKey: 'synthetic-key', model: 'synthetic-model', prefilterOnly: false,
    ...overrides,
  };
  const store: Record<string, unknown> = { antiSlopForXSettings: initial };
  const html = readFileSync(new URL('../entrypoints/options/index.html', import.meta.url), 'utf8');
  const { document, window } = parseHTML(html);
  for (const select of Array.from(document.querySelectorAll('select'))) {
    let value = select.querySelector('option')?.getAttribute('value') ?? '';
    Object.defineProperty(select, 'value', { configurable: true, get: () => value, set: (next: string) => { value = next; } });
  }
  let listener!: (message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean;
  let holdEndpointWrite = false;
  let releaseEndpointWrite: (() => void) | undefined;
  let holdRuleWrite = false;
  let releaseRuleWrite: (() => void) | undefined;
  const confirm = vi.fn(() => true);
  const id = 'synthetic-extension';
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { language: 'en' });
  vi.stubGlobal('window', { confirm });
  vi.stubGlobal('chrome', {
    storage: { local: {
      get: async () => structuredClone(store),
      set: async (value: Record<string, unknown>) => { Object.assign(store, structuredClone(value)); },
      remove: async () => {},
    } },
    permissions: { request: async () => true, contains: async () => true },
    runtime: {
      id,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (value: typeof listener) => { listener = value; } },
      sendMessage: (message: { patch?: Partial<Settings>; ruleEdits?: { accountWhitelist?: unknown } }) => new Promise((resolve) => {
        const deliver = () => listener(message, { id, url: `chrome-extension://${id}/options.html` }, resolve);
        if (holdEndpointWrite && message.patch?.upstreamBaseUrl) releaseEndpointWrite = deliver;
        else if (holdRuleWrite && message.ruleEdits?.accountWhitelist) releaseRuleWrite = deliver;
        else deliver();
      }),
    },
  });
  const background = await import('../entrypoints/background');
  background.default.main();
  const settings = await import('../lib/settings');
  const scorer = await import('../lib/scorer');
  await import('../entrypoints/options/main');
  await vi.waitFor(() => expect((document.querySelector('#model') as unknown as HTMLInputElement).value).toBe('synthetic-model'));
  return {
    document, window, settings, scorer, confirm,
    keep: (handle: string) => new Promise((resolve) => {
      listener({ type: 'ANTI_SLOP_KEEP_ACCOUNT', handle },
        { id, url: 'https://x.com/home', tab: { id: 1, url: 'https://x.com/home' } }, resolve);
    }),
    holdEndpointWrite: () => { holdEndpointWrite = true; },
    releaseEndpointWrite: () => { if (!releaseEndpointWrite) throw new Error('No held endpoint write'); releaseEndpointWrite(); },
    holdRuleWrite: () => { holdRuleWrite = true; },
    releaseRuleWrite: () => { if (!releaseRuleWrite) throw new Error('No held rule write'); releaseRuleWrite(); },
  };
}

describe('options and background settings integration', () => {
  it('can remove an oversized legacy list containing duplicate entries', async () => {
    const page = await openOptions({ accountWhitelist: Array(10_001).fill('alpha') });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = '';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toBe('Saved'));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual([]);
  });

  it('allows an oversized legacy list to be reduced over multiple saves', async () => {
    const original = Array.from({ length: 10_001 }, (_, index) => `user${index}`);
    const page = await openOptions({ accountWhitelist: original });
    const field = page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement;
    field.value = original.slice(5000).join('\n');
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist.length).toBe(5001);
    field.value = original.slice(5001).join('\n');
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist.length).toBe(5000);
  });

  it('explains how to reduce an oversized list before adding entries', async () => {
    const original = Array.from({ length: 5001 }, (_, index) => `user${index}`);
    const page = await openOptions({ accountWhitelist: original });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = `${original.join('\n')}\nextra`;
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toContain('5,000'));
    expect((await page.settings.loadSettings()).accountWhitelist.length).toBe(5001);
  });

  it('explains the per-save limit before rejecting an oversized removal batch', async () => {
    const original = Array.from({ length: 5001 }, (_, index) => `user${index}`);
    const page = await openOptions({ accountWhitelist: original });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = '';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    expect(page.document.querySelector('#status')?.textContent).toContain('5,000');
    expect((await page.settings.loadSettings()).accountWhitelist.length).toBe(5001);
  });

  it('does not warn about an invisible inert empty legacy entry', async () => {
    const page = await openOptions({ accountWhitelist: [''] });
    expect(page.document.querySelector('#status')?.textContent).not.toContain('invalid');
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['']);
  });

  it('explains that reordering does not change account rules', async () => {
    const page = await openOptions({ accountWhitelist: ['alpha', 'gamma'] });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = 'gamma\nalpha';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toContain('order'));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['alpha', 'gamma']);
  });

  it('rejects invalid new account handles without saving other form edits', async () => {
    const page = await openOptions({ accountWhitelist: ['alpha'] });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = 'alpha\nAlice Smith';
    (page.document.querySelector('#model') as unknown as HTMLInputElement).value = 'changed-model';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toContain('Invalid account'));
    expect(await page.settings.loadSettings()).toMatchObject({ accountWhitelist: ['alpha'], model: 'synthetic-model' });
  });

  it('preserves an invalid legacy entry on unrelated saves and reports it', async () => {
    const page = await openOptions({ accountWhitelist: ['legacy invalid'] });
    (page.document.querySelector('#model') as unknown as HTMLInputElement).value = 'changed-model';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent?.startsWith('Saved')).toBe(true));
    expect(page.document.querySelector('#status')?.textContent).toContain('invalid');
    expect(await page.settings.loadSettings()).toMatchObject({ accountWhitelist: ['legacy invalid'], model: 'changed-model' });
  });

  it('allows removing an invalid, oversized, whitespace-padded legacy entry', async () => {
    const oldHandle = ` ${'x'.repeat(201)} `;
    const page = await openOptions({ accountWhitelist: [oldHandle] });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = '';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toBe('Saved'));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual([]);
  });

  it('preserves a multiline legacy entry until the user explicitly clears its list', async () => {
    const page = await openOptions({ accountWhitelist: ['broken\nlegacy', 'alpha'] });
    const field = page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement;
    (page.document.querySelector('#model') as unknown as HTMLInputElement).value = 'changed-model';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['broken\nlegacy', 'alpha']);
    field.value = 'broken\nlegacy\nalpha\ncharlie';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    expect(page.document.querySelector('#status')?.textContent).toContain('multiline');
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['broken\nlegacy', 'alpha']);
    field.value = '';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual([]);
  });

  it('does not delete a concurrent valid keep while removing a padded legacy entry', async () => {
    const page = await openOptions({ accountWhitelist: [' alice '] });
    expect(await page.keep('alice')).toEqual({ ok: true });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = '';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['alice']);
  });

  it('corrects a padded legacy handle without losing a concurrent keep', async () => {
    const page = await openOptions({ accountWhitelist: [' alice '] });
    expect(await page.keep('alice')).toEqual({ ok: true });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = 'alice';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['alice']);
  });

  it('preserves an unchanged empty legacy entry while adding a valid handle', async () => {
    const page = await openOptions({ accountWhitelist: ['', 'alpha'] });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = '\nalpha\ngamma';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['', 'alpha', 'gamma']);
  });

  it('preserves an unchanged invalid legacy line while adding a valid handle', async () => {
    const page = await openOptions({ accountWhitelist: [' Bad Value '] });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = ' Bad Value \ngamma';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual([' Bad Value ', 'gamma']);
  });

  it('lets the user remove and re-add a padded legacy handle', async () => {
    const page = await openOptions({ accountWhitelist: [' alice '] });
    const field = page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement;
    field.value = '';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual([]);
    field.value = 'alice';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect((page.document.querySelector('#save') as unknown as HTMLButtonElement).disabled).toBe(false));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['alice']);
  });

  it('explains when case-only and duplicate changes do not change account rules', async () => {
    const page = await openOptions({ accountWhitelist: ['Alpha', 'Alpha'] });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = 'alpha';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toContain('case-insensitive'));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['Alpha', 'Alpha']);
  });

  it('preserves a keep rule added elsewhere while editing the keep list', async () => {
    const page = await openOptions({ accountWhitelist: ['alpha', 'remove_me'] });
    expect(await page.keep('beta')).toEqual({ ok: true });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = 'alpha\ngamma';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toBe('Saved'));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('keeps a rule added while the stale form save is in flight', async () => {
    const page = await openOptions({ accountWhitelist: ['alpha'] });
    page.holdRuleWrite();
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = 'alpha\ngamma';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    expect(await page.keep('beta')).toEqual({ ok: true });
    page.releaseRuleWrite();
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toBe('Saved'));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('does not restore a keep rule removed elsewhere while adding another', async () => {
    const page = await openOptions({ accountWhitelist: ['alpha', 'beta'] });
    await page.settings.updateSettings(() => ({ accountWhitelist: ['beta'] }));
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = 'alpha\nbeta\ngamma';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toBe('Saved'));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['beta', 'gamma']);
  });

  it('deduplicates concurrent keep additions by case-insensitive account handle', async () => {
    const page = await openOptions({ accountWhitelist: ['alpha'] });
    expect(await page.keep('BETA')).toEqual({ ok: true });
    (page.document.querySelector('#accountWhitelist') as unknown as HTMLTextAreaElement).value = 'alpha\n@Beta\ngamma';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toBe('Saved'));
    expect((await page.settings.loadSettings()).accountWhitelist).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('preserves concurrent additions while editing the hide list', async () => {
    const page = await openOptions({ accountHideList: ['alpha', 'remove_me'] });
    await page.settings.updateSettings((current) => ({ accountHideList: [...current.accountHideList, 'beta'] }));
    (page.document.querySelector('#accountHideList') as unknown as HTMLTextAreaElement).value = 'alpha\ngamma';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toBe('Saved'));
    expect((await page.settings.loadSettings()).accountHideList).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('preserves a newer opt-out when saving an unrelated form edit', async () => {
    const page = await openOptions();
    await page.settings.saveSettingsViaBackground({ prefilterOnly: true });
    (page.document.querySelector('#model') as unknown as HTMLInputElement).value = 'changed-model';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toBe('Saved'));
    expect(await page.settings.loadSettings()).toMatchObject({ prefilterOnly: true, model: 'changed-model', apiKey: 'synthetic-key' });
    expect((page.document.querySelector('#prefilterOnly') as unknown as HTMLInputElement).checked).toBe(true);
  });

  it('rejects a confirmed new origin if another page rotates the key before saving', async () => {
    const page = await openOptions();
    const basis = page.scorer.requestFingerprint(await page.settings.loadSettings());
    page.holdEndpointWrite();
    (page.document.querySelector('#upstreamBaseUrl') as unknown as HTMLInputElement).value = 'https://new.example.test/v1';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    expect(page.confirm).toHaveBeenCalledOnce();
    await page.settings.saveSettingsViaBackground({ apiKey: 'new-synthetic-key' }, basis);
    page.releaseEndpointWrite();
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toContain('changed elsewhere'));
    expect(await page.settings.loadSettings()).toMatchObject({ apiKey: 'new-synthetic-key', upstreamBaseUrl: 'https://example.test/v1' });
  });

  it('rejects a stale model edit after another page changes the credential', async () => {
    const page = await openOptions();
    const basis = page.scorer.requestFingerprint(await page.settings.loadSettings());
    await page.settings.saveSettingsViaBackground({ apiKey: 'new-synthetic-key' }, basis);
    (page.document.querySelector('#model') as unknown as HTMLInputElement).value = 'changed-model';
    page.document.querySelector('#save')!.dispatchEvent(new page.window.Event('click'));
    await vi.waitFor(() => expect(page.document.querySelector('#status')?.textContent).toContain('changed elsewhere'));
    expect(await page.settings.loadSettings()).toMatchObject({ apiKey: 'new-synthetic-key', model: 'synthetic-model' });
  });
});
