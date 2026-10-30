/**
 * OpenAI Decisions adapter: input + questions array with predicate | choice | score.
 * POST typically to /v1/decisions
 */
import type { PostExtract, Settings } from '../types';

export interface OpenAIDecisionsPayload {
  model: string;
  input: string;
  questions: Array<
    | { type: 'predicate'; name: string; instructions: string }
    | {
        type: 'choice';
        name: string;
        instructions: string;
        choices: Array<{ value: string; description?: string }>;
      }
    | {
        type: 'score';
        name: string;
        instructions: string;
        levels: Array<{ label: string; description?: string }>;
      }
  >;
}

export function buildOpenAIDecisionsPayload(
  post: PostExtract,
  settings: Settings,
): OpenAIDecisionsPayload {
  const prompt = settings.defaultPrompt || 'does this look like AI engagement bait / bot reply on X';
  const parts = [`Post by @${post.handle}:\n${post.text}`];
  if (post.parentText) parts.unshift(`Parent:\n${post.parentText}\n`);

  return {
    model: settings.model || 'gpt-5',
    input: parts.join('\n'),
    questions: [
      {
        type: 'predicate',
        name: 'is_slop',
        instructions: prompt,
      },
      {
        type: 'choice',
        name: 'bait_kind',
        instructions: 'If the post is low-quality engagement, which bucket fits best?',
        choices: [
          { value: 'human', description: 'Looks human / not bait' },
          { value: 'praise_bot', description: 'Generic praise / agreement farm' },
          { value: 'pivot_slop', description: 'Rhetorical AI prose' },
          { value: 'promo', description: 'DM / airdrop / bio-link promo' },
          { value: 'other_bot', description: 'Other bot / template reply' },
        ],
      },
      {
        type: 'score',
        name: 'bot_likelihood',
        instructions: 'How likely is this an AI/bot engagement reply on X?',
        levels: [
          { label: 'clearly_human' },
          { label: 'probably_human' },
          { label: 'uncertain' },
          { label: 'probably_bot' },
          { label: 'clearly_bot' },
        ],
      },
    ],
  };
}

export interface OpenAIDecisionsResponse {
  answers?: Array<{
    type?: string;
    name?: string;
    probability?: number;
    choice?: string;
    score?: number;
    confidence?: number;
  }>;
}

export function scoreFromOpenAIDecisions(
  resp: OpenAIDecisionsResponse,
): { score: number; reason: string } {
  const answers = resp.answers ?? [];
  const byName = Object.fromEntries(
    answers.filter((a) => a.name).map((a) => [a.name!, a]),
  );

  const pred = byName.is_slop?.probability;
  const levels = 4;
  const sc =
    typeof byName.bot_likelihood?.score === 'number'
      ? byName.bot_likelihood.score / levels
      : null;
  const choice = byName.bait_kind?.choice ?? null;

  let score = 0;
  if (pred != null && sc != null) score = 0.55 * pred + 0.45 * sc;
  else if (pred != null) score = pred;
  else if (sc != null) score = sc;

  if (choice && choice !== 'human') score = Math.max(score, 0.55);
  if (choice === 'promo') score = Math.max(score, 0.75);

  const parts: string[] = [];
  if (pred != null) parts.push(`predicate=${pred.toFixed(2)}`);
  if (sc != null) parts.push(`score=${sc.toFixed(2)}`);
  if (choice) parts.push(`kind=${choice}`);

  return { score: Math.max(0, Math.min(1, score)), reason: parts.join(', ') || 'openai-decisions' };
}

/** Default decisions path when protocol is openai-decisions */
export const OPENAI_DECISIONS_DEFAULT_PATH = '/decisions';
