/**
 * Cloudflare Worker scaffold (deploy later).
 * Same contract as local mock: POST /v1/decide proxies with caller Authorization.
 *
 * Auth modes (document both; prefer A):
 * A) Key in extension storage; Worker forwards Authorization (no secret in Worker).
 * B) Worker holds upstream key as secret; extension sends an extension-issued token
 *    that Worker validates, then Worker attaches the real upstream key.
 */
export interface Env {
  /** Optional shared token if using mode B */
  EXTENSION_TOKEN?: string;
  /** Optional upstream key if using mode B — set via `wrangler secret put` */
  UPSTREAM_API_KEY?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Anti-Slop-Token',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, mode: 'cloudflare', ts: new Date().toISOString() });
    }
    if (request.method === 'POST' && url.pathname === '/v1/decide') {
      const auth = request.headers.get('Authorization') || '';
      const extToken = request.headers.get('X-Anti-Slop-Token');

      // Mode B optional gate
      if (env.EXTENSION_TOKEN && extToken !== env.EXTENSION_TOKEN) {
        return json({ error: 'Invalid extension token' }, 401);
      }

      const body = (await request.json()) as {
        upstreamBaseUrl?: string;
        upstreamPath?: string;
        payload?: unknown;
      };
      const base = (body.upstreamBaseUrl || '').replace(/\/$/, '');
      const path = body.upstreamPath?.startsWith('/')
        ? body.upstreamPath
        : `/${body.upstreamPath || 'systemone'}`;
      if (!base || !body.payload) return json({ error: 'upstreamBaseUrl and payload required' }, 400);

      const upstreamAuth =
        env.UPSTREAM_API_KEY != null && env.UPSTREAM_API_KEY !== ''
          ? `Bearer ${env.UPSTREAM_API_KEY}`
          : auth;
      if (!upstreamAuth.startsWith('Bearer ')) {
        return json({ error: 'Missing Authorization' }, 401);
      }

      const upstream = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          Authorization: upstreamAuth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body.payload),
      });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    return json({ error: 'Not found' }, 404);
  },
};
