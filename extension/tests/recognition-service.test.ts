import { describe, expect, it, vi } from 'vitest';
import { isRecognitionSender, serveRecognition } from '../lib/recognition-service';
import { requestFingerprint, type TransportSubject } from '../lib/scorer';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';
import type { RecognitionInput } from '../lib/recognition';

const input: RecognitionInput = {
  sources: {
    post: { state: 'available', text: 'Synthetic content' },
    parent: { state: 'not-applicable' },
    root: { state: 'not-applicable' },
    quote: { state: 'not-applicable' },
  },
  required: ['post'],
};

const subject = { handle: 'test_author', isOwn: false, replyScoped: true, automatic: true } as const;

function settings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    endpointPreset: 'custom',
    protocol: 'openai-responses',
    upstreamBaseUrl: 'https://example.test/v1',
    upstreamPath: '/responses',
    apiKey: 'synthetic-key',
    model: 'synthetic-model',
    skipShortText: false,
  };
}

describe('recognition transport admission', () => {
  it('accepts only this extension’s content scripts on X', () => {
    const sender = { id: 'extension-id', url: 'https://x.com/home', tab: { id: 1, url: 'https://x.com/home' } } as chrome.runtime.MessageSender;
    expect(isRecognitionSender(sender, 'extension-id')).toBe(true);
    expect(isRecognitionSender({ ...sender, id: 'other-extension' }, 'extension-id')).toBe(false);
    expect(isRecognitionSender({ ...sender, url: 'https://example.test/' }, 'extension-id')).toBe(false);
    expect(isRecognitionSender({ ...sender, tab: undefined }, 'extension-id')).toBe(false);
    expect(isRecognitionSender({ ...sender, url: 'http://x.com/home' }, 'extension-id')).toBe(false);
  });
  it('does not send when model use is disabled during the permission check', async () => {
    let current = settings();
    let releasePermission!: (granted: boolean) => void;
    let notifyStarted!: () => void;
    const permission = new Promise<boolean>((resolve) => { releasePermission = resolve; });
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    const pending = serveRecognition(
      { input, fingerprint: requestFingerprint(current), subject },
      {
        loadSettings: async () => ({ ...current }),
        hasOriginAccess: async () => { notifyStarted(); return permission; },
        fetcher,
      },
    );
    await started;
    current = { ...current, prefilterOnly: true };
    releasePermission(true);
    const reply = await pending;
    expect(fetcher.mock.calls.length).toBe(0);
    expect(reply).toMatchObject({ ok: true, result: { status: 'unavailable', reason: 'user_opted_out' } });
  });

  it('does not send if a keep rule is added during the permission check', async () => {
    let current = settings();
    let releasePermission!: (granted: boolean) => void;
    let notifyStarted!: () => void;
    const permission = new Promise<boolean>((resolve) => { releasePermission = resolve; });
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    const pending = serveRecognition(
      { input, fingerprint: requestFingerprint(current), subject },
      {
        loadSettings: async () => ({ ...current }),
        hasOriginAccess: async () => { notifyStarted(); return permission; },
        fetcher,
      },
    );
    await started;
    current = { ...current, accountWhitelist: ['test_author'] };
    releasePermission(true);
    expect(await pending).toMatchObject({ ok: true, result: { status: 'unavailable', reason: 'keep_rule' } });
    expect(fetcher.mock.calls.length).toBe(0);
  });

  it('does not send when ownership is unknown and own-post skipping is enabled', async () => {
    const current = settings();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    const reply = await serveRecognition(
      { input, fingerprint: requestFingerprint(current), subject: { ...subject, isOwn: null } },
      { loadSettings: async () => current, hasOriginAccess: async () => true, fetcher },
    );
    expect(reply).toMatchObject({ ok: true, result: { status: 'unavailable', reason: 'own_identity_unknown' } });
    expect(fetcher.mock.calls.length).toBe(0);
  });

  it('does not send to a different endpoint after permission was checked', async () => {
    let current = settings();
    let releasePermission!: (granted: boolean) => void;
    let notifyStarted!: () => void;
    const permission = new Promise<boolean>((resolve) => { releasePermission = resolve; });
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    const pending = serveRecognition(
      { input, fingerprint: requestFingerprint(current), subject },
      {
        loadSettings: async () => ({ ...current }),
        hasOriginAccess: async () => { notifyStarted(); return permission; },
        fetcher,
      },
    );
    await started;
    current = { ...current, upstreamBaseUrl: 'https://another.example.test/v1' };
    releasePermission(true);
    expect(await pending).toEqual({ ok: false, reason: 'stale' });
    expect(fetcher.mock.calls.length).toBe(0);
  });

  it('rechecks changed credentials after host permission returns', async () => {
    let current = settings();
    let releasePermission!: (granted: boolean) => void;
    let notifyStarted!: () => void;
    const permission = new Promise<boolean>((resolve) => { releasePermission = resolve; });
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    const pending = serveRecognition(
      { input, fingerprint: requestFingerprint(current), subject },
      { loadSettings: async () => ({ ...current }), hasOriginAccess: async () => { notifyStarted(); return permission; }, fetcher },
    );
    await started;
    current = { ...current, apiKey: 'different-synthetic-key' };
    releasePermission(true);
    expect(await pending).toEqual({ ok: false, reason: 'stale' });
    expect(fetcher.mock.calls.length).toBe(0);
  });

  it('rechecks keep precedence, scope and automatic scanning before sending', async () => {
    const cases: Array<[Partial<Settings>, TransportSubject, string]> = [
      [{ accountWhitelist: ['test_author'], accountHideList: ['test_author'] }, subject, 'keep_rule'],
      [{ scanScope: 'replies-only' }, { ...subject, replyScoped: false }, 'stale'],
      [{ autoScan: false, debugMode: false }, subject, 'stale'],
      [{ skipShortText: true, shortTextMaxChars: 100 }, subject, 'short_text_preference'],
    ];
    for (const [change, requestSubject, expected] of cases) {
      const current = { ...settings(), ...change };
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
      const reply = await serveRecognition(
        { input, fingerprint: requestFingerprint(current), subject: requestSubject },
        { loadSettings: async () => current, hasOriginAccess: async () => true, fetcher },
      );
      expect(fetcher.mock.calls.length).toBe(0);
      if (expected === 'stale') expect(reply).toEqual({ ok: false, reason: 'stale' });
      else expect(reply).toMatchObject({ ok: true, result: { status: 'unavailable', reason: expected } });
    }
  });

  it('sends one allowed request without local subject metadata in the body', async () => {
    const current = settings();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    const reply = await serveRecognition(
      { input, fingerprint: requestFingerprint(current), subject },
      { loadSettings: async () => current, hasOriginAccess: async () => true, fetcher },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reply.ok && reply.transport?.id).toEqual(expect.any(String));
    expect(reply.ok && reply.transport?.latencyMs).toEqual(expect.any(Number));
    const body = String(fetcher.mock.calls[0][1]?.body);
    expect(body).not.toContain('test_author');
    expect(body).not.toContain('replyScoped');
    expect(body).not.toContain('isOwn');
  });
});
