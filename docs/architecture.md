# Architecture

```
[x.com content script]
  → local prefilter (BotBlind-style)
  → (optional) sends {post} to the background service worker (ANTI_SLOP_DECIDE)
       → service worker POSTs upstreamBaseUrl + decisions path
            → upstream /v1/systemone (Jev) or /v1/decisions (OpenAI Decisions)
              with Authorization: Bearer <the user's own key>
  → fold / badge UI
  → Mute/Block only on user click (native menu, else X web API with cookies)
```

## Auth model: BYOK, no proxy

The extension ships **no key and no server**. Each user pastes their own upstream key in the
options page; it lives in `chrome.storage.local` and is sent only to the base URL they configured.

Why the request must run in the background service worker: content-script fetches are always
subject to the page's CORS policy, while an extension service worker with the matching host
permission is not. `scorer.ts` therefore prefers `chrome.runtime.sendMessage` and only falls back
to a direct call outside the extension (tests).

Endpoints (`extension/lib/endpoints.ts`):

- `jev-official` → `https://api.typesafe.ai/v1` + `/systemone`, protocol `jev`, model `jev-latest`
- `openai-official` → `https://api.openai.com/v1` + `/decisions`, protocol `openai-decisions`, model `gpt-6-luna`
- `custom` → the user's own base URL / path / protocol / model

A preset owns base URL, path and protocol, so a half-configured endpoint is not representable;
`model` stays a user-editable call parameter with the preset value as its default. Settings saved
before `endpointPreset` existed are mapped back by base URL + protocol + path; anything that does
not match a preset exactly becomes `custom`.

Host access:

- Both preset origins are declared in `host_permissions`, so they need no prompt.
- Any other base URL is covered by `optional_host_permissions: ["https://*/*"]`; the options page
  calls `chrome.permissions.request()` on Save/Test (inside the click gesture) for that origin.
- `buildUpstreamUrl()` requires `https://` except for `127.0.0.1` / `localhost`, so the key is never
  sent in clear text to a remote host.

## What this model does and does not protect

- Protects against: the key leaking through a published build, a shared repo, or someone else's
  machine. There is nothing to leak in the artifact.
- Does not protect against: anything that can already read your Chrome profile on your own machine.
  The key is stored in the profile's LevelDB in plaintext, as with any extension that keeps a key.

## Legacy: the bundled proxy (optional, no longer used by the extension)

`worker/src/server.mjs` (Node, `127.0.0.1:8787`) and `worker/src/cf-worker.ts` (Cloudflare) predate
BYOK. The extension no longer calls them. If you want a server-side key instead, deploy a proxy and
point the extension at it, but note the proxy body contract differs from the direct BYOK call.
