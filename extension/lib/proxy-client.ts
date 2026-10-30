/**
 * Extension → local Worker proxy only. Never calls the upstream model API directly.
 * Prefer: API key stays in extension storage; Worker forwards Authorization.
 */
import type { ProxyDecisionBody, Settings } from './types';
import { buildUpstreamPayload, resolveUpstreamPath } from './adapters';
import type { PostExtract } from './types';

export class ProxyError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status = 0, detail = '') {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
    this.detail = detail;
  }
}

export async function decideViaWorker(
  post: PostExtract,
  settings: Settings,
): Promise<unknown> {
  if (!settings.apiKey) {
    throw new ProxyError('No API key configured. Open extension options.');
  }
  const base = (settings.workerBaseUrl || 'http://127.0.0.1:8787').replace(/\/$/, '');
  const path = resolveUpstreamPath(settings);
  const body: ProxyDecisionBody = {
    protocol: settings.protocol,
    upstreamBaseUrl: settings.upstreamBaseUrl.replace(/\/$/, ''),
    upstreamPath: path.startsWith('/') ? path : `/${path}`,
    model: settings.model,
    payload: buildUpstreamPayload(post, settings),
  };

  const res = await fetch(`${base}/v1/decide`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ProxyError(`Worker HTTP ${res.status}`, res.status, detail);
  }
  return res.json();
}
