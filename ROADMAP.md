# Roadmap

What is planned, what is shelved, and why. Each item links to its issue.

## Shelved

- **Strict mode (automatic blocking)** [issue #2](https://github.com/Caph-dev/anti-slop-for-x/issues/2). The historical score-based implementation was switched off in v0.7.0. In the v0.10.0 work, no automatic blocking path or enabling switch is wired into recognition; legacy `strict` settings act as record-only. Any future design needs a separate decision and real-browser verification. Historical guardrails and TLA+ findings are in [docs/strict-mode.md](docs/strict-mode.md).

## Known gaps, not yet planned

- Parent and thread-start relationships cannot currently be proven from the page; complete embedded quotes can be used as comparison context.
- No independently labelled natural/difficult dataset or frozen evaluation supports automatic model folding.
- Replies-only depends on a visible reply header and may miss replies.
- Firefox is not adapted or verified.
- The Chrome Web Store listing needs a final privacy policy, screenshots, and a permission review.
