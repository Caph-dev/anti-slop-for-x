/**
 * Local keyword / pattern prefilter (BotBlind-style signals).
 * Pure module — no chrome APIs. Score is 0..1.
 */
import type { PostExtract, PrefilterHit, PrefilterResult } from './types';

const STOCK_PHRASES: Array<{ id: string; re: RegExp; weight: number }> = [
  { id: 'great_point', re: /\bgreat point\b/i, weight: 0.22 },
  { id: 'couldnt_agree', re: /\bcouldn['']?t agree more\b/i, weight: 0.22 },
  { id: 'this_resonates', re: /\bthis resonates\b/i, weight: 0.2 },
  { id: 'testament', re: /\ba testament to\b/i, weight: 0.25 },
  { id: 'delve', re: /\bdelv(?:e|es|ed|ing)\b/i, weight: 0.28 },
  { id: 'game_changer', re: /\bgame[- ]chang(?:er|ers|ing)\b/i, weight: 0.25 },
  { id: 'fast_paced', re: /\bin today['']?s fast[- ]paced\b/i, weight: 0.3 },
  { id: 'heres_the_thing', re: /\bhere['']?s the thing\b/i, weight: 0.18 },
  { id: 'curious_what', re: /\bcurious (?:what|if|how)\b/i, weight: 0.15 },
  { id: 'love_this', re: /\blove this[!.,]?\b/i, weight: 0.12 },
  { id: 'so_important', re: /\b(?:so|really|truly) important\b/i, weight: 0.12 },
  { id: 'nail_on_head', re: /\bnail(?:ed)? (?:it|on the head)\b/i, weight: 0.18 },
  { id: 'spot_on', re: /\bspot[- ]on\b/i, weight: 0.1 },
  { id: 'this_is_the_way', re: /\bthis is the way\b/i, weight: 0.12 },
  { id: 'underrated', re: /\bunderrated\b/i, weight: 0.1 },
  { id: 'absolutely', re: /^\s*absolutely[!.,]?\s*$/i, weight: 0.2 },
];

const CONTRAST_PIVOT =
  /\bit['']?s not (?:just |only )?.{2,40},\s*it['']?s\b|\bnot\s+\w[\w\s-]{0,30},\s*(?:it['']?s|but)\b|\bless\s+\w+,\s*more\s+\w+/i;

const EMPTY_PRAISE =
  /^(?:great|amazing|awesome|incredible|brilliant|fantastic|love this|so true|this!+)\s*[!.🚀🔥💯👏]*$/i;

const TEMPLATE_EMOJI = /(?:🚀|🔥|💯|👏|✨|🙌){2,}|(?:🚀|🔥|💯).{0,20}(?:🚀|🔥|💯)/u;

const HANDLE_TRAILING_DIGITS = /(?:^|_)\d{4,}$|[A-Za-z]\d{4,}$/;

const DM_AIRDROP_BAIT =
  /\b(?:dm me|check (?:my )?bio|link in bio|airdrop|giveaway|100x|whitel?ist|free tokens?|guaranteed returns?)\b/i;

const SHORTENED_LINK = /\b(?:bit\.ly|t\.co|tinyurl|goo\.gl|cutt\.ly)\/\S+/i;

const EM_DASH_SHORT = /—/;

const ASSISTANT_RESIDUE =
  /\b(?:as an ai|happy to help|hope this helps|certainly[!]|i should (?:note|be clear))\b/i;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
}

/**
 * Ultra-fast long reply: polished-looking text posted within ~60s of parent.
 */
function ultraFastLong(post: PostExtract): PrefilterHit | null {
  if (
    post.createdAtMs == null ||
    post.parentCreatedAtMs == null ||
    !Number.isFinite(post.createdAtMs) ||
    !Number.isFinite(post.parentCreatedAtMs)
  ) {
    return null;
  }
  const delta = post.createdAtMs - post.parentCreatedAtMs;
  if (delta < 0 || delta > 60_000) return null;
  const words = wordCount(post.text);
  if (words < 40) return null;
  return {
    id: 'ultra_fast_long',
    weight: words >= 80 ? 0.45 : 0.3,
    detail: `${Math.round(delta / 1000)}s, ${words} words`,
  };
}

export function runPrefilter(post: PostExtract): PrefilterResult {
  const hits: PrefilterHit[] = [];
  const text = post.text ?? '';

  for (const p of STOCK_PHRASES) {
    if (p.re.test(text)) hits.push({ id: p.id, weight: p.weight });
  }

  if (CONTRAST_PIVOT.test(text)) {
    hits.push({ id: 'contrast_pivot', weight: 0.28 });
  }
  if (EMPTY_PRAISE.test(text.trim())) {
    hits.push({ id: 'empty_praise', weight: 0.35 });
  }
  if (TEMPLATE_EMOJI.test(text)) {
    hits.push({ id: 'template_emoji', weight: 0.22 });
  }
  if (HANDLE_TRAILING_DIGITS.test(post.handle ?? '')) {
    hits.push({ id: 'handle_digits', weight: 0.18, detail: post.handle });
  }
  if (DM_AIRDROP_BAIT.test(text)) {
    hits.push({ id: 'dm_airdrop_bait', weight: 0.85 });
  }
  if (SHORTENED_LINK.test(text)) {
    hits.push({ id: 'short_link', weight: 0.15 });
  }
  if (EM_DASH_SHORT.test(text) && wordCount(text) < 60) {
    hits.push({ id: 'em_dash', weight: 0.12 });
  }
  if (ASSISTANT_RESIDUE.test(text)) {
    hits.push({ id: 'assistant_residue', weight: 0.55 });
  }

  const fast = ultraFastLong(post);
  if (fast) hits.push(fast);

  // Soft human veto: typed laughs / stretched letters → lower score path
  const humanLike =
    /\b(?:lo+l|lmf?ao+|rofl|ha(?:ha)+h?)\b/i.test(text) ||
    /\b\p{L}*([a-z])\1{2,}\p{L}*\b/iu.test(text.replace(/https?:\/\/\S+/g, ''));

  let score = 0;
  for (const h of hits) score += h.weight;
  // Diminishing returns above 1
  score = 1 - Math.exp(-score);
  if (humanLike) score *= 0.55;

  score = clamp01(score);

  const hard = hits.some((h) => h.id === 'dm_airdrop_bait' || h.id === 'assistant_residue');
  if (hard) score = Math.max(score, 0.72);
  score = clamp01(score);

  const decisive = score >= 0.72 || hard;
  const skipModel = humanLike && score < 0.35;

  return { score, hits, decisive, skipModel };
}
