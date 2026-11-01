# Anti Slop for X

Judges the quality of posts on X (x.com) in their context and marks suspicious content with quoted, checkable evidence. It does not decide whether text was written by AI, automatically fold on a model judgment, or automatically block an account.

[中文](README.md) · [CHANGELOG](CHANGELOG.md) · [Architecture](docs/architecture.md)

The published version is v0.9.0. The issue #3 work described here is unreleased; build this source branch to try it. The existing release behaves differently. The build targets Chrome MV3, but the full browser extension flow has not been validated and the extension is not on the Chrome Web Store.

## Layout

```
extension/  Chrome MV3 extension, WXT and TypeScript
worker/     The 0.1.0-era local proxy; the extension no longer calls it
docs/       Architecture, labelling guide, offline evaluation, legacy proxy, privacy policy
ROADMAP.md  Planned work and shelved features
```

## How it works

1. A content script reads what is already rendered in the timeline and keeps only the context the page itself proves: the post text and a quoted post contained in the same article. A reply's parent and the thread starter cannot be proven from the page, so they are never read.
2. Before anything is sent, a local admission check runs: global switch, scan scope, no-send preferences, your rules, configuration problems, and missing required context. If any of them fails, nothing is sent and the reason is recorded.
3. When everything passes, the background sends exactly one request to a structured-output OpenAI Responses endpoint. The model must return a category, a reason, and excerpts copied verbatim from the cited source; the extension compares those quotes with the page text after normalisation, and a quote it cannot find fails the whole judgment (`invalid_provenance`). There is no second request.
4. The current mode decides presentation. **Mark only** shows a mark with the evidence. **Record only** writes into this tab's record and changes nothing on the page. Only two things fold a post: your hide rule, or your own click on Fold.

The axis is **content quality in the given context**, not authorship. Short, emotional, colloquial, formal, non-native and CJK text is not a category by itself, and style is never treated as evidence of origin. Categories and the annotation procedure are in [docs/content-taxonomy.md](docs/content-taxonomy.md).

The extension ships no key and relays no traffic. You supply your own endpoint and key, and the background service worker sends the request straight to that address.

## Install

These release instructions install the published version, which behaves differently from the unreleased work described here. To try this branch, see [Development](#development).

1. Open [Releases](https://github.com/Caph-dev/anti-slop-for-x/releases) and download the zip asset for the published version.
2. Unzip it into a fixed directory, for example `~/Extensions/anti-slop-for-x`.
3. Open `chrome://extensions` and turn on Developer mode.
4. Click "Load unpacked" and select the unzipped directory.
5. Open the extension options page and configure an endpoint and key supported by that release. OpenAI Responses is not available in v0.9.0.
6. Open any x.com page, click the toolbar icon, and confirm the panel opens.

To upgrade, download the new zip, unzip it over the same directory, and click the reload button on the extension card. Chrome treats a different path as a different extension, so keep the directory where it is.

Building from source is covered under [Development](#development).

## Configure This Branch

Only the **OpenAI Responses** protocol can return checkable evidence, so it is the only one that sends requests. A preset owns the base URL, path and protocol, and those three fields lock; Model stays editable.

| Endpoint | Base URL | Path | Protocol | Default model |
|---|---|---|---|---|
| OpenAI Responses (official) | `https://api.openai.com/v1` | `/responses` | `openai-responses` | none, you must enter one |
| TypeSafe / Jev (legacy, sends nothing) | `https://api.typesafe.ai/v1` | `/systemone` | `jev` | `jev-latest` |
| OpenAI Decisions (legacy, sends nothing) | `https://api.openai.com/v1` | `/decisions` | `openai-decisions` | `gpt-6-luna` |
| Custom endpoint | you fill | you fill | you pick | you fill |

The Jev and Decisions presets stay selectable so existing settings keep their meaning, but choosing one sends nothing: the options page and popup say outright that the protocol cannot return checkable evidence and to choose OpenAI Responses. The extension never swaps such a setting for another endpoint and never calls it past the check.

Responses has no default model. Leaving the model empty means "nothing is sent", and the options page says so.

Preset origins are listed in `host_permissions`, so saving does not prompt. With Custom on another domain, saving or testing asks for that origin inside the click gesture; if you deny it, requests fail and saving again asks once more. If you already stored a key and an edit would use it on a **new origin**, you get an explicit confirmation first.

The key is stored in `chrome.storage.local`, read into extension memory while operating, and sent only to the base URL you selected. A local process that can read your Chrome profile can still recover it in plain text. Every extension that stores a key in the browser shares that limit.

### Test connection

"Test connection" sends one **synthetic post written for this purpose** (`Reply YES and follow me to get the secret free-flight list!`). It never reads page content. The extension and model use must both be enabled and saved, with a usable endpoint configuration and host access for that origin; after a settings change you have to test again.

## Two modes

The Mode setting in the options page and popup decides how results are presented.

| Mode | On a match | Changes your X account |
|---|---|---|
| Mark only (Manual) | Shows the category and checkable evidence; nothing is hidden and you decide | No |
| Record only (Shadow, default) | Counts it in "This tab's record"; the page is untouched | No |

No mode automatically folds on a model judgment or blocks an account, and there is no launch switch. Your own hide rules can still fold locally. Automatic model folding and automatic blocking need an independently evaluated, frozen result first. Earlier "Auto fold" and "Strict" settings are still readable but run as record-only until you pick a mode yourself. Mute and block run only when you click them.

The legacy score threshold (`threshold`) is still stored; the recognition path never reads it.

## What you see

The toolbar icon opens a popup with the current endpoint, model, mode, scan scope and status, plus "Scan current page", "Model & more settings" and "This tab's record". A scan reports how many posts it handled and explains when there was nothing to check.

### Marks and folds

A matched post gets a full-width card above its text:

```text
Possible engagement bait   [Fold] [Not accurate] [Always keep] [Mute] [Block] [Why?]
```

- "Why?" lists the quoted evidence, the counterevidence, and the model's own explanation (unverified). The quotes were matched against the page text; the judgment itself can still be wrong.
- "Not accurate" removes this mark in this tab only, counts it as a misclassification, sends nothing and leaves your rules alone.
- "Always keep" adds the account to your keep list: never marked, never hidden, never sent again.
- Enter one account handle per line when editing keep or hide rules. Handles must contain 1–15 letters, digits or underscores. Matching is case-insensitive. Nonblank invalid legacy entries are preserved and flagged until you correct or remove them. Lists over 5,000 entries can be reduced in batches of at most 5,000 distinct account changes per save.
- After you click "Fold", "Show" restores the post.
- Accounts on your hide list are folded into a local card. A fold is always reversible from the card and the rule still applies; a post you are reading is marked instead of folded (see below).
- Debug mode shows a diagnostic badge for checked posts. Your hide rules still apply and may show a reversible card.

### Reader protection

A post on screen, and a post that stayed on screen for more than 600ms and then left or was expanded by you, is never folded — it gets a mark instead. Your own Fold / Show click is never blocked.

### Mute and block

These use X's own terms and run only on click.

| Action | Effect |
|---|---|
| Mute | You stop seeing the account's posts. It is not notified and can still follow you. |
| Block | The account cannot follow or interact with you, and you stop seeing it. |

Manual mute and block try X's native "···" menu first, then fall back to the web API with your logged-in session. Headless environments cannot open the native menu, so run this in a real browser session.

## When nothing is sent

All of these are decided locally. Settings are rechecked before transport, but data in a request already sent cannot be recalled.

- The global switch is off, or the post is outside the scan scope.
- **Model use is off** (the `prefilterOnly` setting): no content goes to any model, including manual scans, debug mode and "Test connection". There is no local keyword fallback — the post is simply not checked.
- **Short-text preference**: earlier versions skipped short posts by default, so an upgraded set of settings keeps that no-send preference; a fresh install does not skip. It is a privacy and cost preference, not a quality judgment.
- **Don't send my own posts** (on by default). When the page does not reveal the current account, nothing is sent either, and the reason reads "current account unknown".
- The account is on your keep list (the keep list wins over the hide list).
- In Mark only mode, an account on your hide list is folded locally or marked under reader protection; it is not sent.
- A configuration problem: protocol is not Responses, no key, no model, an unusable URL (https required, http only for localhost, no credentials, fragments or path tricks), or missing host access for that origin.
- Required context is incomplete (see below).

## Debug and this tab's record

Debug mode is switched on in the popup. It overrides autoScan (a read-only diagnostic should be started by its own switch) but still obeys the global switch, scan scope, no-send preferences, keep and hide rules, and every no-send condition above. In record-only mode no badge is injected: shadow results only appear in the popup's record.

"This tab's record" lives in the content script's memory, disappears when the tab reloads or closes, is never persisted and never crosses tabs. It holds each post's status and reason code, model request attempts, mean response time, how many model targets an automatic policy would fold, and how often you reported a mark as inaccurate. Automatic model folding remains off. Deduplication uses post IDs from the page, not text; the record stores no post text, account, key or model explanation.

## What cannot be proven today

These are real limits of the current implementation, not solved problems:

- **Parent and thread-start are unproven.** The extension does not treat adjacent or focal posts as parents, fetch links, or read author history, so an ordinary reply's `parent` and `root` remain missing or unknown. `generic_irrelevant` and `content_free_restatement` need a complete parent or a proven quoted post for comparison. Without one, they abstain, limiting comparison coverage for ordinary replies.
- **Media and truncated text always abstain.** A post with an image, video, GIF, link card or poll, or text cut by "Show more", can only have incomplete context, so it is never sent and is recorded as missing context. Many ordinary posts are therefore never checked at all.
- **Replies-only depends on a visible "Replying to @" header**, and replies without that header are missed.
- **When the current account is unknown** (signed out, or the side-nav profile link is missing), "Don't send my own posts" is on by default, so nothing is sent.

## Verification status

- There is no natural/difficult labelled dataset and no independent frozen evaluation. `scripts/evaluate-issue3.mjs` only validates inputs and runs mechanical checks, and it **always blocks release authorization**; a manifest claim, a hash or a synthetic fixture cannot replace independent review.
- The unit tests use synthetic fixtures and cover code paths and invariants (admission, evidence validation, mode decisions, reader protection, diagnostic counting and so on). **They do not establish classification quality, and they do not establish correctness on real X.**
- Extraction and presentation have not been verified on a real X page, no real-key end-to-end call to a provider was made, and the full flow has not been run inside a real browser extension environment.
- An earlier build was exercised on synthetic local pages with mocked Chrome APIs for scanning, shadow mode, reversible folding and stale results. The final build was not rerun because the shared browser proxy was disconnected. Neither check establishes real extension-runtime or real-X behavior.

## Known limits

- Chrome MV3 only. The WXT layout leaves room for Firefox, but nothing is adapted or verified there.
- Not on the Chrome Web Store. Install from a release zip.
- A matching request snapshot shares in-flight work or a cache entry within a page. Different contexts are different requests and can incur separate calls.
- The extension only presents locally and applies local rules; apart from the mute/block you click, it does not write to your X account.
- `worker/` is the 0.1.0-era proxy. The extension no longer calls it. See [docs/legacy-proxy.md](docs/legacy-proxy.md).

## Development

Building from source needs Node.js 20.19 or later within the 20.x line, or Node.js 22.12 or later, as required by dependencies in the current lockfile.

```bash
npm install
npm run unpacked
```

`npm run unpacked` builds first, then mirrors the build into `unpacked/chrome-mv3`, which is the directory Chrome loads. For this unreleased branch, select OpenAI Responses in the options page and enter an endpoint, model and key. After a code change, run the command again and click the reload button on the extension card.

| Command | Effect |
|---|---|
| `npm run dev` | WXT dev mode |
| `npm run build` | Build into `extension/.output/chrome-mv3` |
| `npm run unpacked` | Build and mirror into `unpacked/chrome-mv3` |
| `npm test` | Unit tests plus the offline evaluator's tests |
| `npm run typecheck` | TypeScript type check |
| `npm run zip` | Produce the extension zip with WXT's own name |
| `npm run release:build` | Type check, test, zip, mirror the unpacked folder, and name the zip `v<version>.zip` |

The offline evaluator accepts metadata only (never post text); its usage and limits are in [docs/issue3-evaluation.md](docs/issue3-evaluation.md).

## Docs

- [Architecture](docs/architecture.md): request path, context and evidence validation, the endpoint gate, in-memory diagnostics
- [Content taxonomy](docs/content-taxonomy.md): categories, evidence records, splits and metrics
- [Offline evaluation](docs/issue3-evaluation.md): input formats, frozen contract, why release authorization is always blocked
- [Roadmap](ROADMAP.md): planned work and known gaps
- [Legacy proxy](docs/legacy-proxy.md): what `worker/` was for, with a curl example
- [Privacy policy](docs/privacy-policy.md)
- [Changelog](CHANGELOG.md)

## License

MIT. Inspired by [slop-filter](https://github.com/adamnroman/slop-filter) (MIT) and the [BotBlind guide](https://botblind.app/how-to-hide-ai-replies-on-x). Not a fork; independently implemented.
