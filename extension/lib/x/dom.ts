/** X (x.com) DOM helpers — inspired by slop-filter site adapter (MIT). */
import {
  MAX_SOURCE_CHARS,
  type ContextGap,
  type ContextSlot,
  type RecognitionInput,
  type RecognitionSource,
} from '../recognition';

const SEL = {
  TWEET: 'article[data-testid="tweet"]',
  TEXT: '[data-testid="tweetText"]',
  PERMALINK_TIME: 'a[href*="/status/"] time',
  QUOTE_CONTAINER: 'div[role="link"]',
  AVATAR: '[data-testid="Tweet-User-Avatar"]',
  CELL: '[data-testid="cellInnerDiv"]',
  USER_NAME: '[data-testid="User-Name"]',
  SHOW_MORE: '[data-testid="tweet-text-show-more-link"]',
  /** Images, video, GIFs, link cards and polls: content the model never sees. */
  MEDIA: [
    '[data-testid="tweetPhoto"]',
    '[data-testid="videoPlayer"]',
    '[data-testid="videoComponent"]',
    '[data-testid="card.wrapper"]',
    '[data-testid="cardPoll"]',
  ].join(', '),
} as const;

/**
 * Bump when what the extractor reads changes. It is part of the request
 * identity, so results from another extraction are never reused.
 */
export const X_EXTRACTOR_VERSION = 'x-dom-6';

const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:[/?#]|$)/;
const REPLY_LABEL = 'Replying to @';

export interface XPost {
  id: string;
  handle: string;
  text: string;
  isReply: boolean;
  el: HTMLElement;
  createdAtMs: number | null;
  userId: string | null;
}

/** Visible text, keeping emoji that X renders as <img alt="…">. */
function readText(node: Element): string {
  let out = '';
  const walk = (current: Node): void => {
    if (current.nodeType === 3) out += current.nodeValue ?? '';
    else if (current.nodeType === 1) {
      const el = current as Element;
      if (el.tagName === 'IMG') out += el.getAttribute('alt') ?? '';
      else for (const child of Array.from(el.childNodes)) walk(child);
    }
  };
  walk(node);
  return out.replace(/\s+/g, ' ').trim();
}

function hasReplyHeader(article: Element): boolean {
  let text = '';
  const walk = (current: Node): void => {
    if (current.nodeType === 3) text += current.nodeValue ?? '';
    else if (current.nodeType === 1) {
      const el = current as Element;
      if (el !== article && (el.matches(SEL.TEXT) || el.matches(SEL.QUOTE_CONTAINER) ||
        el.matches('.anti-slop-bar, .anti-slop-badge, .anti-slop-debug'))) return;
      for (const child of Array.from(el.childNodes)) walk(child);
    }
  };
  walk(article);
  return text.replace(/\s+/g, ' ').includes(REPLY_LABEL);
}

export function extractTweet(article: Element): XPost | null {
  const link = article.querySelector(SEL.PERMALINK_TIME)?.closest('a');
  const href = link?.getAttribute('href') ?? '';
  const match = href.match(STATUS_PATH);
  const textNode = article.querySelector(SEL.TEXT);
  if (!match || match[1].toLowerCase() === 'i' || !textNode || textNode.closest(SEL.QUOTE_CONTAINER)) return null;

  const timeEl = article.querySelector(SEL.PERMALINK_TIME);
  const datetime = timeEl?.getAttribute('datetime');
  const createdAtMs = datetime ? Date.parse(datetime) : null;

  const isReply = hasReplyHeader(article);

  return {
    id: match[2],
    handle: match[1],
    text: readText(textNode),
    isReply,
    el: article as HTMLElement,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    // X does not expose the numeric user id in the DOM; dedupe uses the handle.
    userId: null,
  };
}

/** Every post article in the page, parseable or not (stale UI must be removable). */
export function listArticles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SEL.TWEET));
}

export function listTweets(root: ParentNode = document): XPost[] {
  const out: XPost[] = [];
  for (const article of root.querySelectorAll(SEL.TWEET)) {
    const t = extractTweet(article);
    if (t) out.push(t);
  }
  return out;
}

/** The embedded quoted post, proven by containment inside this article. */
function quoteContainer(article: Element): Element | null {
  for (const box of Array.from(article.querySelectorAll(SEL.QUOTE_CONTAINER))) {
    if (box.querySelector(`${SEL.USER_NAME}, time, ${SEL.TEXT}`)) return box;
  }
  return null;
}

function anyOutside(article: Element, selector: string, quote: Element | null): boolean {
  return Array.from(article.querySelectorAll(selector)).some((el) => !quote || !quote.contains(el));
}

function slot(text: string, gaps: ContextGap[]): ContextSlot {
  if (!text) return { state: 'missing' };
  let value = text;
  const found = [...gaps];
  if (value.length > MAX_SOURCE_CHARS) {
    value = value.slice(0, MAX_SOURCE_CHARS);
    if (!found.includes('truncated')) found.push('truncated');
  }
  return found.length ? { state: 'partial', text: value, gaps: found } : { state: 'available', text: value };
}

export interface SnapshotPost {
  id: string;
  /** Used for local rules only; never sent to the model. */
  handle: string;
  isReply: boolean;
  isOwn: boolean | null;
}

/** What the page proves about one post, plus the only data a request may carry. */
export interface PostSnapshot {
  post: SnapshotPost;
  input: RecognitionInput;
}

/**
 * Read one article into an evidence snapshot.
 *
 * Context is only `available` when this article proves it: the quoted post is
 * inside the article. A reply's parent and the thread root are never taken from
 * the neighbouring article or from the status page's focal post, because X does
 * not show which post a reply answers; they stay `missing` (labelled reply) or
 * `unknown`. Text cut by "Show more" or accompanied by media is `partial`.
 * No link is fetched and no author history is read.
 */
export function readSnapshot(article: Element, me: string | null): PostSnapshot | null {
  const tweet = extractTweet(article);
  if (!tweet) return null;
  const quote = quoteContainer(article);
  const textNode = Array.from(article.querySelectorAll(SEL.TEXT)).find((el) => !quote || !quote.contains(el));
  if (!textNode) return null;

  const postGaps: ContextGap[] = [];
  if (anyOutside(article, SEL.SHOW_MORE, quote)) postGaps.push('truncated');
  if (anyOutside(article, SEL.MEDIA, quote)) postGaps.push('media');

  let quoteSlot: ContextSlot = { state: 'not-applicable' };
  if (quote) {
    const quoteText = quote.querySelector(SEL.TEXT);
    const quoteGaps: ContextGap[] = [];
    if (quote.querySelector(SEL.SHOW_MORE)) quoteGaps.push('truncated');
    if (quote.querySelector(SEL.MEDIA)) quoteGaps.push('media');
    quoteSlot = slot(quoteText ? readText(quoteText) : '', quoteGaps);
  }

  const unproven: ContextSlot = tweet.isReply ? { state: 'missing' } : { state: 'unknown' };
  const required: RecognitionSource[] = quote ? ['post', 'quote'] : ['post'];
  return {
    post: {
      id: tweet.id,
      handle: tweet.handle,
      isReply: tweet.isReply,
      isOwn: me === null ? null : me.toLowerCase() === tweet.handle.toLowerCase(),
    },
    input: {
      sources: { post: slot(readText(textNode), postGaps), parent: unproven, root: { ...unproven }, quote: quoteSlot },
      required,
    },
  };
}

/** `replies-only` includes only posts whose reply header is visible. */
export function inScope(post: Pick<SnapshotPost, 'id' | 'isReply'>, scope: string, _pathname: string): boolean {
  return scope !== 'replies-only' || post.isReply;
}

/** Post id of an article, for visibility bookkeeping. */
export function postIdOf(article: Element): string | null {
  const href = article.querySelector(SEL.PERMALINK_TIME)?.closest('a')?.getAttribute('href') ?? '';
  return href.match(STATUS_PATH)?.[2] ?? null;
}

export function currentUserHandle(): string | null {
  // Side nav profile link
  const a = document.querySelector(
    'a[data-testid="AppTabBar_Profile_Link"]',
  ) as HTMLAnchorElement | null;
  const href = a?.getAttribute('href');
  if (href && href.startsWith('/')) return href.slice(1).split('/')[0] || null;
  return null;
}

export { SEL };
