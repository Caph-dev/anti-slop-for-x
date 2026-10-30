# Architecture

```
[x.com content script]
  → local prefilter (BotBlind-style)
  → (optional) background/content calls Worker /v1/decide
       → Worker forwards Authorization + payload
            → upstream /v1/systemone (Jev) or /v1/decisions (OpenAI Decisions)
  → fold / badge UI
  → Mute/Block only on user click (native menu, else X web API with cookies)
```

## Auth modes for Worker

**Preferred (v1):** API key in extension storage → `Authorization: Bearer …` on `/v1/decide` → Worker forwards unchanged. Worker repo holds no secrets.

**Alternative (later CF):** Worker secret `UPSTREAM_API_KEY` + extension sends `X-Anti-Slop-Token` validated against `EXTENSION_TOKEN`.

## Local mock vs Cloudflare

- Now: `worker/src/server.mjs` (Node) on `127.0.0.1:8787`
- Later: deploy `worker/src/cf-worker.ts` with wrangler; point options `workerBaseUrl` at the deployed URL
