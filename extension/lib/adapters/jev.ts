/**
 * TypeSafe / Jev adapter: state + questions with noul | choice | score.
 * Extension builds the payload; Worker only proxies with Authorization.
 */
import type { PostExtract, Settings } from '../types';

export interface JevPayload {
  model: string;
  state: { post: { text: string }; parent?: { text: string } };
  questions: Record<
    string,
    {
      type: 'noul' | 'choice' | 'score';
      instructions: string;
      criteria?: unknown;
    }
  >;
}

export function buildJevPayload(post: PostExtract, settings: Settings): JevPayload {
  const state: JevPayload['state'] = { post: { text: post.text } };
  if (post.parentText) state.parent = { text: post.parentText };

  const prompt = settings.defaultPrompt || 'does this look like AI engagement bait / bot reply on X';

  return {
    model: settings.model || 'jev-latest',
    state,
    questions: {
      is_slop: {
        type: 'noul',
        instructions: prompt,
        criteria: {
          true: 'Reads like AI engagement bait, bot praise, template spam, or promo bait on X.',
          false: 'Reads like a real person reacting, disagreeing, joking, or adding a specific point.',
        },
      },
      bait_kind: {
        type: 'choice',
        instructions: 'If the post is low-quality engagement, which bucket fits best?',
        criteria: {
          human: 'Looks human / not bait',
          praise_bot: 'Generic praise / agreement farm',
          pivot_slop: 'Rhetorical "not X, it\'s Y" style AI prose',
          promo: 'DM / airdrop / bio-link promo',
          other_bot: 'Other bot / template reply',
        },
      },
      bot_likelihood: {
        type: 'score',
        instructions: 'How likely is this an AI/bot engagement reply on X?',
        criteria: [
          'Clearly human',
          'Probably human',
          'Uncertain',
          'Probably AI/bot',
          'Clearly AI/bot bait',
        ],
      },
    },
  };
}

export interface JevResponse {
  answers?: {
    is_slop?: { type: string; noul?: number };
    bait_kind?: { type: string; choice?: string; confidence?: number };
    bot_likelihood?: { type: string; score?: number; confidence?: number };
  };
  usage?: unknown;
  model?: string;
}

/** Map Jev answers to a single 0..1 score + reason. */
export function scoreFromJev(resp: JevResponse): { score: number; reason: string } {
  const a = resp.answers ?? {};
  const noul = typeof a.is_slop?.noul === 'number' ? a.is_slop.noul : null;
  const levels = 4; // criteria length - 1 for score question
  const scoreAns =
    typeof a.bot_likelihood?.score === 'number' ? a.bot_likelihood.score / levels : null;
  const choice = a.bait_kind?.choice ?? null;

  let score = 0;
  if (noul != null && scoreAns != null) score = 0.55 * noul + 0.45 * scoreAns;
  else if (noul != null) score = noul;
  else if (scoreAns != null) score = scoreAns;

  if (choice && choice !== 'human') score = Math.max(score, 0.55);
  if (choice === 'promo') score = Math.max(score, 0.75);

  const parts: string[] = [];
  if (noul != null) parts.push(`noul=${noul.toFixed(2)}`);
  if (scoreAns != null) parts.push(`score=${scoreAns.toFixed(2)}`);
  if (choice) parts.push(`kind=${choice}`);

  return { score: Math.max(0, Math.min(1, score)), reason: parts.join(', ') || 'jev' };
}
