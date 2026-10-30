#!/usr/bin/env node
/**
 * Local mock / proxy for slop-shield.
 * Extension → this server → upstream (ai.caph.me etc.) with Authorization from the request.
 * No API keys stored here. Cloudflare Worker deploy comes later (see cf-worker.ts).
 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body, extraHeaders = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS,
    ...extraHeaders,
  });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true, mode: 'local-mock', ts: new Date().toISOString() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/decide') {
    try {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ') || auth.length < 20) {
        send(res, 401, { error: 'Missing or short Authorization Bearer token from extension' });
        return;
      }

      const body = await readJson(req);
      const upstreamBase = String(body.upstreamBaseUrl || '').replace(/\/$/, '');
      const upstreamPath = String(body.upstreamPath || '/systemone');
      const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
      const payload = body.payload;
      if (!upstreamBase || !payload) {
        send(res, 400, { error: 'upstreamBaseUrl and payload are required' });
        return;
      }

      const target = `${upstreamBase}${path}`;
      const upstream = await fetch(target, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25_000),
      });

      const text = await upstream.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        send(res, 502, { error: 'Upstream non-JSON', status: upstream.status, detail: text.slice(0, 800) });
        return;
      }

      if (!upstream.ok) {
        send(res, upstream.status, { error: 'Upstream error', status: upstream.status, body: json });
        return;
      }

      send(res, 200, json);
    } catch (err) {
      send(res, 500, { error: String(err?.message || err) });
    }
    return;
  }

  send(res, 404, { error: 'Not found', path: url.pathname });
});

server.listen(PORT, HOST, () => {
  console.log(`[slop-shield-worker] local mock listening on http://${HOST}:${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /v1/decide  (forwards Authorization + payload to upstream)`);
});
