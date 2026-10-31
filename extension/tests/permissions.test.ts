import { afterEach, describe, expect, it, vi } from 'vitest';
import { originPattern, requestOriginAccess } from '../lib/permissions';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('originPattern', () => {
  it('builds a host-only match pattern (ports are not valid in match patterns)', () => {
    expect(originPattern('https://api.typesafe.ai/v1')).toBe('https://api.typesafe.ai/*');
    expect(originPattern('https://api.typesafe.ai/v1/systemone')).toBe('https://api.typesafe.ai/*');
    // Chrome rejects "http://localhost:8787/*"; the pattern covers all ports instead.
    expect(originPattern('http://localhost:8787')).toBe('http://localhost/*');
    expect(originPattern('http://127.0.0.1:8787/v1/decide')).toBe('http://127.0.0.1/*');
  });

  it('keeps the scheme', () => {
    expect(originPattern('http://localhost:3000')).toBe('http://localhost/*');
    expect(originPattern('https://localhost:3000')).toBe('https://localhost/*');
  });

  it('rejects empty, malformed and non-http URLs', () => {
    expect(originPattern('')).toBeNull();
    expect(originPattern('   ')).toBeNull();
    expect(originPattern('not a url')).toBeNull();
    expect(originPattern('file:///etc/passwd')).toBeNull();
    expect(originPattern('chrome-extension://abc/x')).toBeNull();
  });
});

describe('requestOriginAccess', () => {
  it('returns false for an unusable URL without touching chrome', () => {
    const request = vi.fn();
    vi.stubGlobal('chrome', { permissions: { request } });
    return requestOriginAccess('nope').then((ok) => {
      expect(ok).toBe(false);
      expect(request).not.toHaveBeenCalled();
    });
  });

  it('requests the host pattern and reports a denial as false', async () => {
    const request = vi.fn(async () => {
      throw new Error('denied');
    });
    vi.stubGlobal('chrome', { permissions: { request } });

    await expect(requestOriginAccess('https://example.com/v1')).resolves.toBe(false);
    expect(request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
  });

  it('passes the grant through', async () => {
    const request = vi.fn(async () => true);
    vi.stubGlobal('chrome', { permissions: { request } });

    await expect(requestOriginAccess('https://example.com/v1')).resolves.toBe(true);
  });
});
