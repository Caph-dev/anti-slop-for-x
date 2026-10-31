# Roadmap

What is planned, what is shelved, and why. Each item links to its issue.

## Shelved

- **Strict mode (automatic blocking)** [issue #2](https://github.com/Caph-dev/anti-slop-for-x/issues/2). Built, switched off in v0.7.0. It blocks the author when the model scores above `max(0.9, threshold)`. Automatic blocking is destructive and publicly visible, and the whole path has never run in a real browser session. Re-enabling needs a live block, a live undo, and the rate-limit checks listed in the issue. The guards and the TLA+ findings are in [docs/strict-mode.md](docs/strict-mode.md).

## Known gaps, not yet planned

- Deduplication keys on the handle, because `userId` is not parsed from the DOM.
- No author-level evidence. One high-scoring reply is enough to act on.
- Firefox is not adapted or verified.
- The Chrome Web Store listing needs a final privacy policy, screenshots, and a permission review.
