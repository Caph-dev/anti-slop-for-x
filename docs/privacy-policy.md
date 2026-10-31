# Privacy Policy (draft) — Anti Slop for X

**Status:** draft for self-use / future Chrome Web Store listing.  
**Last updated:** 2026-10-30 (Asia/Shanghai)

## What the extension does

Anti Slop for X runs in your browser on `x.com` / `twitter.com`. It reads the text, handle, and timestamps of posts/replies **already visible in your tab**, scores them with a local keyword prefilter, and optionally sends text to a **decision model endpoint you configure** (bring your own key).

## Data we collect

The extension authors do **not** operate a telemetry backend in v1.

- Post text / handles scored locally stay in your browser memory (in-page cache).
- Settings (including API key) are stored in `chrome.storage.local` on your device.
- When the model path is enabled, the extension sends post text **directly to the upstream base URL you configured**, authenticated with **your own API key**.

## What we do not do

- No silent auto-mute or auto-block. Mute / Block run **only** after you click.
- No selling of browsing data.
- The extension vendors no API key. The key you paste is stored in `chrome.storage.local` and is never sent anywhere except the base URL you configured.

## Third parties

- **X / Twitter**: you already use their site; Mute/Block use the same logged-in session.
- **Your upstream model provider** (e.g. TypeSafe Jev): subject to that provider’s policy.

## Contact

Maintainer: Caph-dev (Anti Slop for X).
