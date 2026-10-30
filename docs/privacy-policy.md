# Privacy Policy (draft) — Slop Shield

**Status:** draft for self-use / future Chrome Web Store listing.  
**Last updated:** 2026-10-30 (Asia/Shanghai)

## What the extension does

Slop Shield runs in your browser on `x.com` / `twitter.com`. It reads the text, handle, and timestamps of posts/replies **already visible in your tab**, scores them with a local keyword prefilter, and optionally sends text to a **decision model through a Worker you control**.

## Data we collect

The extension authors do **not** operate a telemetry backend in v1.

- Post text / handles scored locally stay in your browser memory (in-page cache).
- Settings (including API key) are stored in `chrome.storage.local` on your device.
- When the model path is enabled, the extension sends post text to **your configured Worker URL** with your Authorization header; the Worker forwards to your configured upstream.

## What we do not do

- No silent auto-mute or auto-block. Mute / Block run **only** after you click.
- No selling of browsing data.
- The upstream API key is **not** committed to the repository. Prefer keeping it in extension storage and letting the Worker proxy the Authorization header.

## Third parties

- **X / Twitter**: you already use their site; Mute/Block use the same logged-in session.
- **Your Worker / upstream model provider** (e.g. TypeSafe Jev via a proxy you run): subject to that provider’s policy.

## Contact

Maintainer: Caph-dev (temporary project name: slop-shield).
