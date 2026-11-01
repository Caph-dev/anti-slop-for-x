import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractTweet, inScope, readSnapshot } from '../lib/x/dom';
import { parseRecognition } from '../lib/recognition';
import { mountCard } from '../lib/ui';

afterEach(() => vi.unstubAllGlobals());

function article(body: string): Element {
  const { document } = parseHTML(`<html><body><article data-testid="tweet"><a href="/alice/status/123"><time datetime="2025-01-01T00:00:00Z"></time></a>${body}</article></body></html>`);
  return document.querySelector('article') as unknown as Element;
}

describe('reply scope', () => {
  it('does not treat reply-like post text as a reply header', () => {
    const node = article('<div data-testid="tweetText">Replying to @bob is a UI label I am documenting.</div>');
    const post = extractTweet(node);
    expect(post?.isReply).toBe(false);
    expect(post && inScope(post, 'replies-only', '/home')).toBe(false);
  });

  it('ignores text injected by its own card when detecting reply headers', () => {
    const node = article('<div data-testid="tweetText">Replying to @bob is a UI label I am documenting.</div>');
    vi.stubGlobal('document', node.ownerDocument);
    const before = readSnapshot(node, 'viewer');
    mountCard(node as HTMLElement, {
      presentation: 'advisory', kind: 'model', title: 'Example', handle: 'alice',
      evidence: [{ source: 'post', quote: 'Replying to @bob' }], counterevidence: [],
      rationale: 'Replying to @bob is part of the post text.',
    }, {}, (key) => key, '123');
    const after = readSnapshot(node, 'viewer');
    expect(after?.post.isReply).toBe(false);
    expect(after?.input).toEqual(before?.input);
    expect(after && inScope(after.post, 'replies-only', '/home')).toBe(false);
  });

  it('recognizes a separate reply header outside the post text', () => {
    const node = article('<div>Replying to <a href="/bob">@bob</a></div><div data-testid="tweetText">Thanks for the update.</div>');
    expect(extractTweet(node)?.isReply).toBe(true);
  });

  it('does not infer a reply merely from a non-focal article on a status page', () => {
    expect(inScope({ id: '999', isReply: false }, 'replies-only', '/alice/status/111')).toBe(false);
  });

  it('uses an embedded quoted post as proven comparison context', () => {
    const node = article('<div data-testid="tweetText">The workshop is on Friday.</div><div role="link"><div data-testid="User-Name">Quoted author</div><div data-testid="tweetText">The workshop is on Friday.</div></div>');
    const snapshot = readSnapshot(node, 'viewer');
    expect(snapshot?.input.sources.quote).toMatchObject({ state: 'available', text: 'The workshop is on Friday.' });
    expect(snapshot?.input.required).toContain('quote');
    expect(parseRecognition({
      verdict: 'classified', category: 'content_free_restatement', reason: 'No added content.',
      evidence: [{ source: 'post', quote: 'workshop' }, { source: 'quote', quote: 'workshop' }], counterevidence: [],
    }, snapshot!.input)).toMatchObject({ status: 'classified', category: 'content_free_restatement' });
  });

  it('does not treat an internal status URL as an author handle', () => {
    const node = article('<div data-testid="tweetText">A synthetic post.</div>');
    node.querySelector('a')?.setAttribute('href', '/i/status/123');
    expect(extractTweet(node)).toBeNull();
    expect(readSnapshot(node, 'viewer')).toBeNull();
  });

  it('retains unknown ownership instead of treating it as another account', () => {
    const node = article('<div data-testid="tweetText">A synthetic post.</div>');
    expect(readSnapshot(node, null)?.post.isOwn).toBeNull();
  });
});
