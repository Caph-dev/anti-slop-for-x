/**
 * OpenAI Decisions adapter: input + questions array with predicate | choice | score.
 * POST typically to /v1/decisions
 */
import type { PostExtract, Settings } from '../types';
import {
  BAIT_KIND_HUMAN_DESCRIPTION,
  BAIT_KIND_INSTRUCTIONS,
  BOT_LIKELIHOOD_INSTRUCTIONS,
  BOT_LIKELIHOOD_LEVELS,
  resolvePrompt,
} from '../prompt';

/** Wire labels for the score question; `scoreFromOpenAIDecisions` maps score/4. */
const BOT_LEVEL_LABELS = [
  'clearly_human',
  'probably_human',
  'uncertain',
  'probably_bot',
  'clearly_bot',
];

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
  const prompt = resolvePrompt(settings);
  const parts = [`Post by @${post.handle}:\n${post.text}`];
  if (post.parentText) parts.unshift(`Parent:\n${post.parentText}\n`);

  return {
    model: settings.model || 'gpt-6-luna',
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
        instructions: BAIT_KIND_INSTRUCTIONS,
        choices: [
          { value: 'human', description: BAIT_KIND_HUMAN_DESCRIPTION },
          { value: 'praise_bot', description: 'Generic praise / agreement farm' },
          { value: 'pivot_slop', description: 'Rhetorical AI prose' },
          { value: 'promo', description: 'DM / airdrop / bio-link promo' },
          { value: 'other_bot', description: 'Other bot / template reply' },
        ],
      },
      {
        type: 'score',
        name: 'bot_likelihood',
        instructions: BOT_LIKELIHOOD_INSTRUCTIONS,
        levels: BOT_LEVEL_LABELS.map((label, i) => ({
          label,
          description: BOT_LIKELIHOOD_LEVELS[i]?.split(' — ').slice(1).join(' — ') || undefined,
        })),
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
