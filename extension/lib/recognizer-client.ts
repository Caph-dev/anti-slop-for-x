import { buildOpenAIResponsesPayload, parseOpenAIResponsesEnvelope } from './adapters/openai-responses';
import { missingRequired, recognitionContext, type Recognition, type RecognitionInput } from './recognition';

export interface RecognizerConfig {
  protocol: string;
  baseUrl: string;
  path: string;
  model: string;
  apiKey: string;
  modelUse: boolean;
}

/**
 * The one URL a request may go to: https (or loopback http), no credentials,
 * fragments or path tricks. Null means the configuration is not usable.
 */
export function endpointUrl(baseUrl: string, path: string): string | null {
  try {
    if (/[\\\s]/u.test(baseUrl.trim())) return null;
    const base = new URL(baseUrl.trim());
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) ||
      base.username || base.password || base.hash || baseUrl.includes('#')) return null;
    const suffix = path.trim();
    if (!suffix) return base.href;
    // Joining a path to a base query would change its meaning; require an unambiguous configuration.
    if (base.search || baseUrl.includes('?') || suffix.startsWith('//') || /^[a-z][a-z\d+.-]*:/iu.test(suffix) || /[\\#\s]/u.test(suffix)) return null;
    const pathPart = suffix.split('?')[0];
    if (pathPart.split('/').some((segment) => {
      const decoded = decodeURIComponent(segment);
      return decoded === '.' || decoded === '..' || /[\\/]/u.test(decoded);
    })) return null;
    const joined = new URL(`${base.href.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`);
    return joined.origin === base.origin && !joined.hash ? joined.href : null;
  } catch {
    return null;
  }
}

/** Sends one explicit Responses request; errors contain no provider or request data. */
export async function recognizeUpstream(
  input: RecognitionInput,
  config: RecognizerConfig,
  fetcher: typeof fetch = fetch,
): Promise<Recognition> {
  const context = recognitionContext(input);
  if (!config.modelUse) return { status: 'unavailable', reason: 'user_opted_out', context };
  if (config.protocol !== 'openai-responses') return { status: 'unavailable', reason: 'unsupported_protocol', context };
  const key = (config.apiKey || '').trim();
  if (!key) return { status: 'unavailable', reason: 'missing_key', context };
  const model = (config.model || '').trim();
  if (!model) return { status: 'unavailable', reason: 'missing_model', context };
  const missing = missingRequired(input);
  if (missing.length) return { status: 'abstained', cause: 'missing_context', missing, context };
  const url = endpointUrl(config.baseUrl || '', config.path || '');
  if (!url) return { status: 'unavailable', reason: 'invalid_config', context };

  const signal = AbortSignal.timeout(20_000);
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildOpenAIResponsesPayload(input, model)),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      const error = response.status === 429 ? 'rate_limited' : response.status === 401 || response.status === 403 ? 'authentication' : 'http';
      return { status: 'failed', error, context };
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      if (signal.aborted || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) {
        return { status: 'failed', error: 'timeout', context };
      }
      return { status: 'failed', error: 'invalid_json', context };
    }
    return parseOpenAIResponsesEnvelope(raw, input);
  } catch (error) {
    return { status: 'failed', error: signal.aborted || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) ? 'timeout' : 'network', context };
  }
}
