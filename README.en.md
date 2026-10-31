# Anti Slop for X

Scores replies on X (x.com) for AI and bot slop, then marks, folds, or blocks depending on the score.

[中文](README.md) · [CHANGELOG](CHANGELOG.md) · [Architecture](docs/architecture.md)

Current version is v0.7.1. Verified on Chrome only. Not published to the Chrome Web Store.

## Layout

```
extension/  Chrome MV3 extension, WXT and TypeScript
worker/     The 0.1.0-era local proxy; the extension no longer calls it
docs/       Architecture, legacy proxy, privacy policy
ROADMAP.md  Planned work and shelved features
```

## How it works

1. A content script reads the replies already rendered in the timeline.
2. A local keyword prefilter produces a 0..1 score. Strong matches are decided without calling a model.
3. Borderline replies go to the decision model you configure, and the model score is blended with the prefilter score.
4. The current mode decides what happens: mark the reply, or fold it.

The extension holds no key and relays no traffic. You supply your own endpoint and key, and the background service worker sends the request straight to that address. Scoring stays between your machine and the upstream you chose.

## Install

1. Open [Releases](https://github.com/Caph-dev/anti-slop-for-x/releases) and download the latest `anti-slop-for-x-extension-<version>-chrome.zip`.
2. Unzip it into a fixed directory, for example `~/Extensions/anti-slop-for-x`.
3. Open `chrome://extensions` and turn on Developer mode.
4. Click "Load unpacked" and select the unzipped directory.
5. Fill in the endpoint and key on the extension options page.
6. Open any x.com page, click the toolbar icon, and confirm the panel opens.

To upgrade, download the new zip, unzip it over the same directory, and click the reload button on the extension card. Chrome treats a different path as a different extension, so keep the directory where it is.

Building from source is covered under [Development](#development).

## Configure

The Endpoint setting picks the base URL, decisions path, and protocol. Choosing an official preset fills those three fields and locks them. Only Custom lets you edit them. Model stays editable in every mode; the preset only supplies its default.

| Endpoint | Base URL | Path | Protocol | Default model |
|---|---|---|---|---|
| TypeSafe / Jev (official) | `https://api.typesafe.ai/v1` | `/systemone` | `jev` | `jev-latest` |
| OpenAI Decisions (official) | `https://api.openai.com/v1` | `/decisions` | `openai-decisions` | `gpt-6-luna` |
| Custom endpoint | you fill | you fill | you pick | you fill |

Both preset origins are listed in `host_permissions`, so saving does not prompt. With Custom on another domain, saving asks Chrome for access to that origin. If you deny it, requests fail, and saving again asks once more.

The key lives in `chrome.storage.local` and is sent only to the base URL you selected. A local process that can read your Chrome profile directory can still recover the key in plain text. Every extension that stores a key in the browser shares that limit.

The OpenAI preset was verified with a real key. `gpt-6-luna` appears in `/v1/models`, `POST https://api.openai.com/v1/decisions` returns HTTP 200, and `answers[]` matches the parser. The captured response is a fixture at `extension/tests/fixtures/openai-decisions-real.json`.

## Two modes

The Mode setting decides what happens after scoring.

| Mode | Above the threshold | Changes your X account |
|---|---|---|
| Manual | Shows the AI likelihood, hides nothing | No |
| Auto Fold (default) | Folds the reply | No |

Neither mode writes to your X account. Mute and block run only when you click them.

## What you see

The toolbar icon opens a popup. It shows the current endpoint, model, mode, scan scope, and status, plus a "Scan current page" button and an "Options" button. A scan reports how many replies it handled and explains when there was nothing to scan.

A reply above the threshold folds into one full-width card.

```text
Possible AI/bot 55%   [Show] [Mute] [Block]
```

- **Show** restores the reply. The card collapses into a clickable `AI? 55%` pill next to the timestamp, and clicking the pill folds the reply again.
- Hovering the card shows the raw score breakdown. The card itself shows only the AI likelihood.
- A reply below the threshold but at or above 70% of it is not folded. It gets a passive `AI? nn%` marker next to the timestamp.

### Mute and block

These use X's own terms.

| Action | Effect |
|---|---|
| Mute | You stop seeing the account's posts. It is not notified and can still follow you. |
| Block | The account cannot follow or interact with you, and you stop seeing it. |

Manual mute and block try X's native "···" menu first, then fall back to the web API with your logged-in session. Headless environments cannot open the native menu, so run this in a real browser session.

## Known limits

- Chrome MV3 only. The WXT layout leaves room for Firefox, but nothing is adapted or verified there.
- Not on the Chrome Web Store. Install from a release zip.
- Deduplication uses the handle, because `userId` is not parsed from the DOM yet.
- `worker/` is the 0.1.0-era proxy. The extension no longer calls it. See [docs/legacy-proxy.md](docs/legacy-proxy.md).

## Development

Building from source needs Node.js 20.12 or later, which is what `wxt` declares in `engines`.

```bash
npm install
npm run unpacked
```

`npm run unpacked` builds first, then mirrors the build into `unpacked/chrome-mv3`, which is the directory Chrome loads. After a code change, run it again and click the reload button on the extension card.

| Command | Effect |
|---|---|
| `npm run dev` | WXT dev mode |
| `npm run build` | Build into `extension/.output/chrome-mv3` |
| `npm run unpacked` | Build and mirror into `unpacked/chrome-mv3` |
| `npm test` | Run unit tests |
| `npm run typecheck` | TypeScript type check |
| `npm run zip` | Produce the extension zip with WXT's own name |
| `npm run release:build` | Type check, test, zip, mirror the unpacked folder, and name the zip `v<version>.zip` |

## Docs

- [Architecture](docs/architecture.md): request path, endpoint presets, what BYOK does and does not protect
- [Roadmap](ROADMAP.md): planned work and known gaps
- [Legacy proxy](docs/legacy-proxy.md): what `worker/` was for, with a curl example
- [Privacy policy draft](docs/privacy-policy.md)
- [Changelog](CHANGELOG.md)

## License

MIT. Inspired by [slop-filter](https://github.com/adamnroman/slop-filter) (MIT) and the [BotBlind guide](https://botblind.app/how-to-hide-ai-replies-on-x). Not a fork; independently implemented.
