/**
 * Extension → upstream model API, direct (BYOK).
 * The API key is the user's own: it stays in chrome.storage.local and is sent
 * only to the base URL the user configured.
 *
 * Must be called from the background service worker (or another extension
 * page) — content-script fetch is subject to the page's CORS policy even with
 * host permissions. `background.ts` already routes decisions through the SW.
 */
import type { PostExtract, Settings } from './types';
import { buildUpstreamPayload, resolveUpstreamPath } from './adapters';
import { resolveEndpoint } from './endpoints';

export class UpstreamError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status = 0, detail = '') {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.detail = detail;
  }
}

/** Hosts where plain HTTP is acceptable: exactly the loopback entries the
 * manifest declares (`http://127.0.0.1/*`, `http://localhost/*`). */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * Join a user-supplied base URL with a decisions path.
 * Base trailing slashes and path leading slashes are normalized, so
 * `https://api.typesafe.ai/v1/` + `/systemone` → `https://api.typesafe.ai/v1/systemone`.
 */
export function buildUpstreamUrl(baseUrl: string, path: string): string {
  const base = (baseUrl || '').trim();
  if (!base) {
    throw new UpstreamError('Upstream base URL is empty. Open extension options.');
  }

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new UpstreamError(`Invalid upstream base URL: ${base}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UpstreamError(`Unsupported upstream protocol: ${parsed.protocol}`);
  }
  if (parsed.protocol === 'http:' && !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new UpstreamError(
      'Refusing to send the API key over plain HTTP. Use https:// (http is allowed only for 127.0.0.1 / localhost).',
    );
  }

  const trimmedBase = base.replace(/\/+$/, '');
  const rawPath = (path || '').trim();
  const suffix = rawPath ? (rawPath.startsWith('/') ? rawPath : `/${rawPath}`) : '';
  return `${trimmedBase}${suffix}`;
}

/** POST one post's payload upstream with the user's own key. */
export async function decideUpstream(
  post: PostExtract,
  settings: Settings,
): Promise<unknown> {
  const apiKey = (settings.apiKey || '').trim();
  if (!apiKey) {
    throw new UpstreamError('No API key configured. Open extension options and paste your own key.');
  }

  const endpoint = resolveEndpoint(settings);
  const effective: Settings = {
    ...settings,
    protocol: endpoint.protocol,
    model: endpoint.model,
  };
  const url = buildUpstreamUrl(
    endpoint.baseUrl,
    endpoint.path || resolveUpstreamPath(effective),
  );
  const body = buildUpstreamPayload(post, effective);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const msg = (e as Error)?.name === 'TimeoutError'
      ? `Upstream timed out: ${url}`
      : `Cannot reach ${url}. Check the base URL, and re-save options so Chrome grants host access. (${(e as Error)?.message || String(e)})`;
    throw new UpstreamError(msg);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const hint = res.status === 401 || res.status === 403
      ? ' The upstream rejected your API key.'
      : '';
    throw new UpstreamError(`Upstream HTTP ${res.status}.${hint}`, res.status, detail.slice(0, 300));
  }

  return res.json();
}
