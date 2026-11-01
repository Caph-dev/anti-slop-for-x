# Privacy Policy (draft) — Anti Slop for X

**Status:** draft for self-use / future Chrome Web Store listing.
**Last updated:** 2026-11-01 (Asia/Shanghai)

## What the extension does

Anti Slop for X runs in your browser on `x.com` / `twitter.com`. It reads the text of posts and
quoted posts **already rendered in your tab**, decides locally whether that content may be sent, and —
only if you enabled model use and configured an endpoint — sends the supplied post text to **the
endpoint you chose**, using **your own API key**.

It judges content quality in context. It does not infer whether a human or a model wrote the text, it
does not score accounts, and it never automatically folds on a model judgment or blocks an account.
Your own hide rules can fold posts locally.

## What is sent to your endpoint

When a post passes every local check, one request goes to the Responses endpoint you configured:

- the post text, and any quoted post text proven to be part of the same post;
- for each of those sources, whether the text is complete or incomplete, and whether media was present
  that the model cannot see (a flag only — **media is never uploaded**);
- which sources the judgment requires, plus the chosen model, fixed instructions and output schema.

The **author handle, whether the post is yours, post IDs, the page URL, your settings and your key**
are not added separately to the request body. Supplied post text may itself contain handles, links or
other personal information. The handle and ownership state are local-only metadata used for your
keep/hide/own-post rules; the key travels only as the `Authorization` header to the endpoint you
selected. Post-recognition requests are made by the background service worker directly to that origin.
The explicitly requested synthetic connection test runs from the options page. The extension authors
operate no proxy or relay.

If the protocol you selected cannot return checkable evidence (the legacy TypeSafe / Jev and OpenAI
Decisions entries), nothing is sent — the extension tells you to choose OpenAI Responses instead.

## What stays on your device

- **Settings**, including your API key, in `chrome.storage.local`. Extension contexts read settings into
  memory while operating; the configured key is not added separately to the model request body or
  diagnostic record. Any secret present in the post text itself would still be sent as post text.
  Settings from the old `slopShieldSettings` key remain there until the next settings write migrates
  them; when both keys exist, the older key can retain an older copy of the API key until then.
- **Recognition results** in the tab's page memory, keyed by request identity; gone when the page
  reloads.
- **This tab's record** (diagnostics) in the content script's memory only: outcome counts such as
  `classified:normal`, `abstained:missing_context`, `failed:rate_limited`, the number of model request
  attempts, mean response time, how many posts a fold-everything policy would have folded (none were),
  how often you reported a mark as inaccurate, and the presentations applied. Post IDs are used as an
  in-memory deduplication key and are not returned or written anywhere. **No post text, account, key,
  URL or model explanation is stored.** Reloading or closing the tab erases it.
- **Your rules** (keep list, hide list) and the mode/scope preferences, in `chrome.storage.local`.
- **Action log** entries from earlier versions that could mute or block automatically. That feature is
  off; the log is shown in the popup so you can review or undo what those versions did.

## What we do not do

- No telemetry, analytics or crash reporting backend. The extension authors receive nothing.
- No silent auto-mute or auto-block. Mute and Block run **only** after you click them, using your
  logged-in X session. Automatic model folding and automatic account blocking are disabled, with no
  setting that turns them on.
- No automatic model-based fold or account action. Record-only mode changes nothing on the page;
  mark-only mode can insert an advisory card that you can fold, expand or dismiss.
- No background collection of author history, follower graphs or other posts.
- No selling or sharing of browsing data.
- The extension vendors no API key. The key you paste is stored in `chrome.storage.local` and is never
  sent anywhere except the base URL you configured.

## Controls you have

- **Model use off** (`prefilterOnly`): no model request is started after the extension observes this
  setting, including manual scans, debug mode and the connection test. Changing a setting cannot recall
  data from a request that has already been sent.
- **Don't send short posts** and **Don't send my own posts**: local no-send preferences. If the page
  does not reveal which account is yours, the own-post preference blocks sending rather than guessing.
- **Scan scope** and the global switch, both local. The connection test also requires the extension to
  be enabled and checks the switch again before sending.
- **Keep list** (always keep, wins over everything) and **hide list** (fold locally, never send).
  Neither list mutes or blocks anyone on X.
- **Not accurate** removes a mark in this tab and counts it locally; nothing is sent.
- **Always keep** adds the account to your local keep list.
- Every fold is reversible from its card, and a post you are reading is marked instead of folded.

## Endpoint and key handling

- The key lives in `chrome.storage.local` and is sent only to the base URL you selected.
- Only `https` endpoints are accepted (`http` only for `localhost` / `127.0.0.1`); credentials,
  fragments and path tricks are rejected.
- Host access for a custom origin is requested when you save or test. If an already stored key would be
  used on a **new origin**, you get an explicit confirmation first.
- The connection test sends one synthetic post written for that purpose, never content from your page.
- A local process that can read your Chrome profile directory can still recover the key in plain text.
  Every extension that stores a key in the browser shares that limit.

## Retention

- `chrome.storage.local`: settings, rules and the legacy action log, until you change or remove them
  (or uninstall the extension).
- Page memory and the per-tab record: until the page reloads or the tab closes.
- Nothing is uploaded to the extension authors, because there is no server to upload to.

## Third parties

- **X / Twitter**: you already use their site; Mute / Block use the same logged-in session.
- **Your model provider** (for example OpenAI): content sent there is subject to that provider's
  policy, retention and billing. The extension cannot control or verify what they do with it.

## Scope of validation

The privacy-relevant behaviour described here is covered by tests over synthetic data, including local
pages exercised in a browser with mocked Chrome APIs. It has **not** been verified on a real X session,
with a real provider key, or inside a real browser extension environment. See the "Verification status"
section of the READMEs for the precise gaps.

## Contact

Maintainer: Caph-dev (Anti Slop for X).
