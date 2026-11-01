# Architecture

The extension judges **content quality in context** and presents it under the user's control. It does
not infer authorship or automatically fold on a model judgment. A user's hide rule can fold locally;
account blocking remains manual.

```
[x.com content script]
  → extract proven context (post text, quoted post inside the same article)
  → local admission: switch, scope, no-send preferences, rules, config, missing context
       ↓ (nothing sent)                                 ↓ (all pass)
  record reason locally                          background service worker
                                                     POST baseUrl + /responses, protocol openai-responses
                                                     Authorization: Bearer <user's own key>
                                                     body: model, instructions, schema and source slots
  ← structural validation → evidence matched against page text
  → manual: mark with evidence (user may fold)
  → shadow: record only, page untouched
  → mute/block only on user click
```

## Modules

| File | Role |
|---|---|
| `extension/lib/x/dom.ts` | Extraction. Versioned (`X_EXTRACTOR_VERSION`); only context proven inside one article is `available`. |
| `extension/lib/recognition.ts` | Types plus structural validation of inputs and model output, including literal quote provenance. |
| `extension/lib/scorer.ts` | Request identity/fingerprint, local admission, page-owned cache. |
| `extension/lib/recognition-service.ts` | Background side: sender check, settings reload, re-check, then transport. |
| `extension/lib/recognizer-client.ts` | The one URL rule and the single Responses request. |
| `extension/lib/adapters/openai-responses.ts` | Prompt, JSON schema and envelope parsing. |
| `extension/lib/account-rules.ts` | Validated account-list deltas merged into the latest settings in the background queue. |
| `extension/lib/mode.ts` | What a recognition does to a post. Pure, no DOM or storage. |
| `extension/lib/reader-protection.ts` | Never collapse something the user is reading. |
| `extension/lib/diagnostics.ts` | Per-tab, in-memory record of outcomes. |
| `extension/lib/ui.ts` | Marks, folds and debug badges. Untrusted text is written with `textContent` only. |

`prefilter.ts`, `prompt.ts` and the Jev / Decisions adapters remain in the tree (the legacy prompt is
still preserved as a setting), but no recognition path calls them. There is no local score and no
local fallback: a post is either sent to the configured Responses endpoint, or it gets a local state
that says why not.

## Admission: nothing is sent without passing

`admission()` in `scorer.ts` is the single gate, and `transportExclusion()` runs it again in the
background immediately before the request with freshly loaded settings. A non-null result means the
post is not sent:

- `disabled` — the global switch is off, including the connection test.
- `user_opted_out` — the stored `prefilterOnly` value. **No model request happens at all**, including
  manual scans, debug mode and the options page's connection test, which checks the stored value as
  well as the form value.
- `own_post_preference` / `own_identity_unknown` — "don't send my own posts" is on by default. A `null`
  identity (page reveals no current account) blocks sending rather than assuming someone else's post.
- `keep_rule` — a keep-list match wins over every other rule, including a hide-list match.
- `hide_rule` — folded locally, never sent.
- `short_text_preference` — legacy installs keep their stored skip; new installs do not skip.
- `unsupported_protocol`, `missing_key`, `missing_model`, `invalid_config` — configuration problems,
  each surfaced with an actionable message.
- `abstained` with `cause: missing_context` — a required source is not fully available.

Host access for the endpoint origin is checked in the background before transport
(`serveRecognition`), not inside `admission()`; a missing grant produces `unavailable/permission`
instead of a request.

## Request identity and cache

`requestFingerprint()` covers protocol, effective URL, model, the prompt / schema / extractor /
context-policy versions and the opaque `credentialRevision` (never the key). `recognitionIdentity()`
adds the canonical snapshot. Results are cached in page memory only, keyed by that identity, so a
change of endpoint, model or key can never reuse an older judgment. Only classified results and
model-level abstentions are cacheable; failures are retried on the next explicit trigger.

The popup and options page send settings patches to one background write queue. The options page sends
only fields changed from its loaded form and includes its model-configuration fingerprint; the queue
rejects a stale configuration edit. This prevents an untouched older form value from overwriting a
newer no-send preference. Account lists are sent as additions and removals relative to the form's
baseline, then merged into the latest lists inside the queue, preserving concurrent keep rules. New
handles must match X's 1–15-character account-name syntax. Invalid legacy entries remain unchanged
until edited or removed, and their raw identity is retained when computing removals so a concurrent
valid keep cannot be deleted by mistake. Legacy settings are read without mutating storage and migrated on the next
queued write, so an older read cannot overwrite a later preference. The content script discards older
settings reads after a newer one starts. These checks cannot recall a request already sent, and account
changes on the X page are not independently verified by the background.

## Context policy

`readSnapshot()` supplies `post`, `parent`, `root`, `quote` with a state:

- `available` — complete text of a source proven to belong to this post.
- `partial` — known-incomplete text: cut by "Show more", or accompanied by media the model cannot see.
- `missing` / `unknown` — a labelled reply whose parent cannot be proven, or a source whose existence
  the page does not reveal.
- `not-applicable` — the source does not exist.

A reply's parent and the thread start are **never** taken from a neighbouring article or the status
page's focal post, because X does not show which post a reply answers. Nothing is fetched and no
author history is read. Consequences, stated plainly:

- `generic_irrelevant` and `content_free_restatement` require evidence from a complete parent or a
  proven quoted post. The extractor cannot establish ordinary reply-parent relationships, so those
  categories have limited coverage outside posts containing an available quote.
- A `partial` or missing `post` abstains before transport, so media posts and truncated posts are never
  sent.
- `replies-only` scope (`inScope`) depends on a visible "Replying to @" header and can miss replies.

## Output validation

The model must answer with the fixed schema (`verdict`, `category`, `reason`, `evidence`,
`counterevidence`). `parseRecognition()` then checks structure, category membership, and every cited
quote against the normalised (NFC, whitespace-collapsed) source text. A quote that cannot be located
in the cited source fails the entire judgment as `invalid_provenance`; classified results need `post`
evidence, and comparison categories need `parent` or `quote` evidence. Quotes from `partial` text are allowed
(they are literally present); quotes from absent text are not. `reason` is shown as an unverified
model explanation, never as established fact.

## Endpoint gate

Only `openai-responses` can produce checkable evidence, so it is the only protocol that sends:

- `openai-responses` → `https://api.openai.com/v1` + `/responses`, model supplied by the user, **no
  default**; an empty model blocks sending.
- `jev-official` and `openai-official` remain for stored settings. They resolve, report
  `unsupported_protocol`, and are never called and never auto-swapped.
- `custom` uses the user's own base URL, path and protocol, still subject to the same protocol gate.

`deriveEndpointPreset()` maps pre-preset settings back by base URL + protocol + path and **never infers
the Responses protocol**, so an upgrade cannot start sending to a new endpoint. `endpointUrl()`
requires https (http only for `localhost` / `127.0.0.1`) and rejects credentials, fragments and path
tricks. Host access is requested inside the Save/Test click gesture; if a stored key would be reused
on a different origin, the options page asks for explicit confirmation first.

## What is and is not sent

Sent: the chosen model, fixed instructions, output schema, four source slots with their state, text and
gaps, and which sources are required. `buildOpenAIResponsesPayload()` constructs this body explicitly.

Not separately sent: the author handle, `isOwn`, post IDs, the page URL, settings and the diagnostics
record. The supplied post text itself can contain handles, links or other personal data. The handle,
`isOwn`, reply-scope flag and scan trigger are local-only subject metadata used for admission in the
background. The key is sent in the `Authorization` header to the configured endpoint. Settings are
rechecked immediately before transport, but changing them cannot recall a request already sent.

## Presentation

`decide()` in `mode.ts` is pure and testable:

- `shadow` (and legacy `auto-fold` / `strict`) always presents `none`; the counterfactual is recorded.
- `manual` presents `advisory` for a target, `none` for `normal`, and `fail_open` otherwise.
- `keep` returns `none` before any category is considered.
- `hide` folds — and a hard guard in both `decide()` and `mountCard()` refuses any other fold source.
  There is no setting that makes a model fold a post.

Reader protection (`reader-protection.ts`, 600ms grace) turns a fold into a mark when the post is on
screen or was already read. Words used in the UI are the user's: Fold, Show, Not accurate, Always keep,
Mute, Block. "Not accurate" is local and per tab; "Always keep" writes only to the local keep list.

## Diagnostics

`createDiagnostics()` holds state in the content script's memory for the life of the tab. Entries hold
enum codes only; a post ID is used as the in-memory deduplication key but is never returned or persisted.
Counters are: model request attempts (counted once per transport id), mean end-to-end latency,
`status:code` outcome counts, counterfactual folds, applied presentations and user "not accurate"
reports. The popup reads it through a message to the tab. Nothing here is persisted, and no post text,
handle or model rationale is kept.

## Auth model: BYOK, no proxy

The extension ships no key and no server. Each user pastes their own upstream key in the options page;
it lives in `chrome.storage.local` and is sent only to the base URL they configured. Post recognition
requests run in the background service worker because content-script fetches are subject to the page's
CORS policy while an extension worker with the matching host permission is not. The explicitly requested
synthetic connection test runs from the options page.

- Protects against: a key leaking through a published build, a shared repo, or someone else's machine.
- Does not protect against: anything that can already read your Chrome profile on your own machine.
  The key sits in the profile's LevelDB in plaintext, as with any extension that stores a key.

## Offline evaluation

`scripts/evaluate-issue3.mjs` validates metadata-only samples, predictions and a manifest, and runs
predeclared mechanical checks. It makes no network requests and **always blocks release authorization**
(exit status 2), because a real sampling method and dataset need an independently reviewed plan and
certificate. Synthetic fixtures, a manifest claim or a hash cannot grant approval. See
[docs/issue3-evaluation.md](issue3-evaluation.md).

## Not established

There is no natural/difficult labelled dataset, no independent frozen evaluation, no real-provider
end-to-end run, no real-X verification of extraction or presentation, and no run inside a real browser
extension environment. Synthetic local pages were exercised in a browser with mocked Chrome APIs.
The tests cover invariants, not classification quality.

## Legacy: the bundled proxy (optional, no longer used by the extension)

`worker/src/server.mjs` (Node, `127.0.0.1:8787`) and `worker/src/cf-worker.ts` (Cloudflare) predate
BYOK. The extension no longer calls them. If you want a server-side key instead, deploy a proxy and
point the extension at it, but note the proxy body contract differs from the direct BYOK call.
