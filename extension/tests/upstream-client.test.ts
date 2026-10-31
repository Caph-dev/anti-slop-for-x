import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUpstreamUrl, decideUpstream, UpstreamError } from '../lib/upstream-client';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    endpointPreset: 'custom',
    apiKey: 'test-key-123456',
    upstreamBaseUrl: 'https://api.typesafe.ai/v1',
    upstreamPath: '/systemone',
    ...overrides,
  };
}

const post = {
  id: 'p1',
  handle: 'someone',
  text: 'Great point! This is a game-changer',
  isReply: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildUpstreamUrl', () => {
  it('joins base and path without doubling slashes', () => {
    expect(buildUpstreamUrl('https://api.typesafe.ai/v1', '/systemone')).toBe(
      'https://api.typesafe.ai/v1/systemone',
    );
    expect(buildUpstreamUrl('https://api.typesafe.ai/v1/', '/systemone')).toBe(
      'https://api.typesafe.ai/v1/systemone',
    );
    expect(buildUpstreamUrl('https://api.typesafe.ai/v1/', 'systemone')).toBe(
      'https://api.typesafe.ai/v1/systemone',
    );
  });

  it('keeps the bare base URL when the path is empty', () => {
    expect(buildUpstreamUrl('https://api.typesafe.ai/v1', '')).toBe('https://api.typesafe.ai/v1');
  });

  it('rejects plain HTTP to a remote host (key would travel in clear)', () => {
    expect(() => buildUpstreamUrl('http://api.typesafe.ai/v1', '/systemone')).toThrow(UpstreamError);
  });

  it('allows plain HTTP on loopback for local test servers', () => {
    expect(buildUpstreamUrl('http://127.0.0.1:8787', '/systemone')).toBe(
      'http://127.0.0.1:8787/systemone',
    );
    expect(buildUpstreamUrl('http://localhost:8787', '/x')).toBe('http://localhost:8787/x');
  });

  it('rejects empty and non-http URLs', () => {
    expect(() => buildUpstreamUrl('', '/systemone')).toThrow(UpstreamError);
    expect(() => buildUpstreamUrl('ftp://example.com', '/x')).toThrow(UpstreamError);
    expect(() => buildUpstreamUrl('not a url', '/x')).toThrow(UpstreamError);
  });
});

describe('decideUpstream', () => {
  it('fails before any request when no key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(decideUpstream(post, settings({ apiKey: '   ' }))).rejects.toThrow(
      /No API key configured/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the payload to the configured endpoint with the user key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const raw = await decideUpstream(post, settings());

    expect(raw).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key-123456');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      state: { post: { text: string } };
      questions: Record<string, unknown>;
    };
    expect(body.model).toBe('jev-latest');
    expect(body.state.post.text).toBe(post.text);
    expect(Object.keys(body.questions)).toContain('is_slop');
  });

  it('surfaces a rejected key as an auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 })),
    );

    const err = await decideUpstream(post, settings()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).status).toBe(401);
    expect((err as UpstreamError).message).toMatch(/rejected your API key/);
  });

  it('ignores stale fields when a built-in preset is selected', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await decideUpstream(
      post,
      settings({
        endpointPreset: 'openai-official',
        upstreamBaseUrl: 'https://stale.example.com/v1',
        upstreamPath: '/stale',
        protocol: 'jev',
        model: 'stale',
      }),
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      input: string;
      questions: unknown[];
    };
    // Base URL, path and protocol come from the preset; model stays editable.
    expect(body.model).toBe('stale');
    expect(body.input).toContain(post.text);
    expect(Array.isArray(body.questions)).toBe(true);
  });
});
