/** X (x.com) DOM helpers — inspired by slop-filter site adapter (MIT). */

const SEL = {
  TWEET: 'article[data-testid="tweet"]',
  TEXT: '[data-testid="tweetText"]',
  PERMALINK_TIME: 'a[href*="/status/"] time',
  QUOTE_CONTAINER: 'div[role="link"]',
  AVATAR: '[data-testid="Tweet-User-Avatar"]',
  CELL: '[data-testid="cellInnerDiv"]',
  USER_NAME: '[data-testid="User-Name"]',
} as const;

const STATUS_PATH = /^\/([^/]+)\/status\/(\d+)/;
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

function readText(node: Element): string {
  return (node.textContent || '').replace(/\s+/g, ' ').trim();
}

export function extractTweet(article: Element): XPost | null {
  const link = article.querySelector(SEL.PERMALINK_TIME)?.closest('a');
  const href = link?.getAttribute('href') ?? '';
  const match = href.match(STATUS_PATH);
  const textNode = article.querySelector(SEL.TEXT);
  if (!match || !textNode || textNode.closest(SEL.QUOTE_CONTAINER)) return null;

  const timeEl = article.querySelector(SEL.PERMALINK_TIME);
  const datetime = timeEl?.getAttribute('datetime');
  const createdAtMs = datetime ? Date.parse(datetime) : null;

  const isReply = (article.textContent || '').includes(REPLY_LABEL);

  // Best-effort user id from avatar link data
  let userId: string | null = null;
  const avatarLink = article.querySelector(`${SEL.AVATAR} a[href^="/"]`) as HTMLAnchorElement | null;
  // X sometimes embeds rest_id in nested scripts; leave null if unknown.

  return {
    id: match[2],
    handle: match[1],
    text: readText(textNode),
    isReply,
    el: article as HTMLElement,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    userId,
  };
}

export function listTweets(root: ParentNode = document): XPost[] {
  const out: XPost[] = [];
  for (const article of root.querySelectorAll(SEL.TWEET)) {
    const t = extractTweet(article);
    if (t) out.push(t);
  }
  return out;
}

export function parentTextFor(article: HTMLElement, tweet: XPost): string | null {
  // Joined thread line above avatar
  const cell = article.closest(SEL.CELL);
  const above = cell?.previousElementSibling?.querySelector(SEL.TWEET);
  if (above) {
    const parent = extractTweet(above);
    if (parent && parent.handle !== tweet.handle && parent.text) return parent.text;
  }

  // Status page focal
  const statusId = location.pathname.match(STATUS_PATH)?.[2];
  if (!statusId || tweet.id === statusId) return null;
  for (const a of document.querySelectorAll(SEL.TWEET)) {
    const t = extractTweet(a);
    if (t?.id === statusId) return t.text;
  }
  return null;
}

export function parentCreatedAtMs(article: HTMLElement, tweet: XPost): number | null {
  const cell = article.closest(SEL.CELL);
  const above = cell?.previousElementSibling?.querySelector(SEL.TWEET);
  if (above) {
    const parent = extractTweet(above);
    if (parent && parent.handle !== tweet.handle) return parent.createdAtMs;
  }
  const statusId = location.pathname.match(STATUS_PATH)?.[2];
  if (!statusId || tweet.id === statusId) return null;
  for (const a of document.querySelectorAll(SEL.TWEET)) {
    const t = extractTweet(a);
    if (t?.id === statusId) return t.createdAtMs;
  }
  return null;
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
