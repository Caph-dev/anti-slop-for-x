import { describe, expect, it, vi } from 'vitest';
import { recognizeUpstream, type RecognizerConfig } from '../lib/recognizer-client';
import type { RecognitionInput } from '../lib/recognition';

const input: RecognitionInput = {
  sources: { post: { state: 'available', text: 'Synthetic private post' }, parent: { state: 'available', text: 'Synthetic parent' }, root: { state: 'missing' }, quote: { state: 'not-applicable' } },
  required: ['post'],
};
const config: RecognizerConfig = { protocol: 'openai-responses', baseUrl: 'https://example.test/v1/', path: '/responses?mode=test', model: 'chosen-model', apiKey: 'secret-key', modelUse: true };
const result = { verdict: 'classified', category: 'normal', reason: 'A reason', evidence: [{ source: 'post', quote: 'Synthetic private post' }], counterevidence: [{ source: 'parent', quote: 'Synthetic parent' }] };
const envelope = (content: unknown) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [content] }] });
const output = (value: unknown) => envelope({ type: 'output_text', text: JSON.stringify(value) });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('recognizeUpstream', () => {
  it('sends exactly one request to the configured URL with the chosen model and validated evidence', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(output(result)));
    const response = await recognizeUpstream(input, config, fetcher);
    expect(response).toMatchObject({ status: 'classified', category: 'normal', evidence: result.evidence, counterevidence: result.counterevidence });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://example.test/v1/responses?mode=test');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer secret-key', 'Content-Type': 'application/json' } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string).model).toBe('chosen-model');
  });

  it('makes no request for opt-out, unsupported protocol, missing configuration or context', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const [override, reason] of [
      [{ modelUse: false }, 'user_opted_out'], [{ protocol: 'jev' }, 'unsupported_protocol'],
      [{ protocol: 'openai-decisions' }, 'unsupported_protocol'], [{ protocol: 'unknown' }, 'unsupported_protocol'],
      [{ apiKey: ' ' }, 'missing_key'], [{ model: ' ' }, 'missing_model'],
    ] as const) {
      expect(await recognizeUpstream(input, { ...config, ...override }, fetcher)).toMatchObject({ status: 'unavailable', reason });
    }
    expect(await recognizeUpstream({ ...input, required: ['root'] }, config, fetcher)).toMatchObject({ status: 'abstained', cause: 'missing_context', missing: ['root'] });
    expect(await recognizeUpstream({ ...input, sources: { ...input.sources, post: { state: 'missing' } } }, config, fetcher)).toMatchObject({ status: 'abstained', cause: 'missing_context', missing: ['post'] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects unsafe or ambiguous URLs without sending credentials', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const [baseUrl, path] of [
      ['not a url', '/responses'], ['http://remote.test', '/responses'], ['https://user:pass@example.test', '/responses'],
      ['https://example.test/#fragment', '/responses'], ['https://example.test', '//evil.test/path'],
      ['https://example.test', '/\\evil.test'], ['https://example.test', '/%2e%2e/other'],
      ['https://example.test?existing=1', '/responses'], ['https://example.test', '/responses#fragment'], ['https://example.test', 'https://evil.test'],
    ]) {
      expect(await recognizeUpstream(input, { ...config, baseUrl, path }, fetcher)).toMatchObject({ status: 'unavailable', reason: 'invalid_config' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts loopback HTTP and preserves a base query when path is empty', async () => {
    for (const baseUrl of ['http://localhost:1234/api?x=1', 'http://127.0.0.1:1234/api?x=1']) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(output(result)));
      await recognizeUpstream(input, { ...config, baseUrl, path: '' }, fetcher);
      expect(fetcher.mock.calls[0][0]).toBe(baseUrl);
    }
  });

  it('maps HTTP and fetch errors without returning private diagnostics', async () => {
    for (const [status, error] of [[429, 'rate_limited'], [401, 'authentication'], [403, 'authentication'], [500, 'http']] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-key provider-private', { status }));
      const response = await recognizeUpstream(input, config, fetcher);
      expect(response).toMatchObject({ status: 'failed', error });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(response)).not.toMatch(/secret-key|provider-private|Synthetic private post|example\.test/);
    }
    for (const [name, expected] of [['TimeoutError', 'timeout'], ['AbortError', 'timeout'], ['TypeError', 'network']] as const) {
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error('secret-key provider-private'), { name }));
      const response = await recognizeUpstream(input, config, fetcher);
      expect(response).toMatchObject({ status: 'failed', error: expected });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(response)).not.toMatch(/secret-key|provider-private|Synthetic private post|example\.test/);
    }
  });

  it('aborts a pending request on its bounded timeout', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const pending = recognizeUpstream(input, config, fetcher);
      expect(timeout).toHaveBeenCalledWith(20_000);
      controller.abort();
      expect(await pending).toMatchObject({ status: 'failed', error: 'timeout' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it('maps malformed JSON, refusal, incomplete, invalid output and invalid provenance', async () => {
    const cases: [Response, string][] = [
      [new Response('{'), 'invalid_json'],
      [json(envelope({ type: 'refusal', refusal: 'provider-private' })), 'refusal'],
      [json({ status: 'incomplete', output: [] }), 'incomplete'],
      [json({ status: 'completed', output: [] }), 'invalid_output'],
      [json(output({ ...result, evidence: [{ source: 'post', quote: 'fabricated' }] })), 'invalid_provenance'],
      [json(envelope({ type: 'output_text', text: '{' })), 'invalid_json'],
    ];
    for (const [raw, error] of cases) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(raw);
      const response = await recognizeUpstream(input, config, fetcher);
      expect(response).toMatchObject({ status: 'failed', error });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(response)).not.toMatch(/secret-key|provider-private|Synthetic private post|example\.test|fabricated/);
    }
  });
});
