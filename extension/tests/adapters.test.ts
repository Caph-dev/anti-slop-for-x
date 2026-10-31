import { describe, expect, it } from 'vitest';
import { buildJevPayload, scoreFromJev } from '../lib/adapters/jev';
import {
  buildOpenAIDecisionsPayload,
  scoreFromOpenAIDecisions,
} from '../lib/adapters/openai-decisions';
import { DEFAULT_SETTINGS } from '../lib/types';
import {
  BAIT_KIND_INSTRUCTIONS,
  BOT_LIKELIHOOD_INSTRUCTIONS,
  DEFAULT_PROMPT,
} from '../lib/prompt';
import realDecision from './fixtures/openai-decisions-real.json';
import regressionCases from './fixtures/prompt-regression-cases.json';

const post = {
  id: '9',
  handle: 'bob',
  text: 'Absolutely love this, game-changer!',
  isReply: true,
  parentText: 'I shipped a thing',
};

describe('jev adapter', () => {
  it('builds state + noul/choice/score questions', () => {
    const p = buildJevPayload(post, DEFAULT_SETTINGS);
    expect(p.model).toBe('jev-latest');
    expect(p.state.post.text).toContain('game-changer');
    expect(p.state.parent?.text).toBe('I shipped a thing');
    expect(p.questions.is_slop.type).toBe('noul');
    expect(p.questions.bait_kind.type).toBe('choice');
    expect(p.questions.bot_likelihood.type).toBe('score');
  });

  it('sends the shared rules to every question, including when the prompt is blank', () => {
    const p = buildJevPayload(post, { ...DEFAULT_SETTINGS, defaultPrompt: '' });

    // An emptied or whitespace-only prompt gets the current rules, not the
    // old one-liner and not an empty instruction.
    expect(p.questions.is_slop.instructions).toBe(DEFAULT_PROMPT);
    expect(
      buildJevPayload(post, { ...DEFAULT_SETTINGS, defaultPrompt: '   ' }).questions.is_slop
        .instructions,
    ).toBe(DEFAULT_PROMPT);
    expect(p.questions.bait_kind.instructions).toBe(BAIT_KIND_INSTRUCTIONS);
    expect(p.questions.bot_likelihood.instructions).toBe(BOT_LIKELIHOOD_INSTRUCTIONS);
    // A directive naming a bot is insufficient evidence, not proof of authorship.
    expect(JSON.stringify(p.questions.is_slop.criteria)).toContain('@bot');
    const kinds = p.questions.bait_kind.criteria as Record<string, string>;
    expect(kinds.human).toContain('@bot');
    expect(String(p.questions.bot_likelihood.criteria)).toContain('no concrete AI tell');
  });

  it('keeps a custom prompt', () => {
    const p = buildJevPayload(post, { ...DEFAULT_SETTINGS, defaultPrompt: 'my rules' });
    expect(p.questions.is_slop.instructions).toBe('my rules');
  });

  it('sends the reported @bot case verbatim, with the rule that governs it', () => {
    // Request construction only. Whether the model now scores these below the
    // fold threshold needs a real key; see
    // extension/tests/fixtures/prompt-regression-cases.json.
    for (const c of regressionCases.reported_false_positive_2026_11_01) {
      const p = buildJevPayload({ ...post, handle: c.handle, text: c.text }, DEFAULT_SETTINGS);
      expect(p.state.post.text).toBe(c.text);
      expect(p.questions.is_slop.instructions).toContain('@bot do X');
      expect(p.questions.is_slop.instructions).toContain('Chinese, Japanese or Korean');
    }
  });

  it('scores from noul + score answers', () => {
    const { score, reason } = scoreFromJev({
      answers: {
        is_slop: { type: 'noul', noul: 0.9 },
        bait_kind: { type: 'choice', choice: 'praise_bot' },
        bot_likelihood: { type: 'score', score: 3.2 },
      },
    });
    expect(score).toBeGreaterThan(0.7);
    expect(reason).toContain('noul=');
  });
});

describe('openai-decisions adapter', () => {
  it('builds predicate/choice/score array', () => {
    const p = buildOpenAIDecisionsPayload(post, {
      ...DEFAULT_SETTINGS,
      protocol: 'openai-decisions',
      model: 'gpt-6-luna',
    });
    expect(p.questions[0].type).toBe('predicate');
    expect(p.questions[1].type).toBe('choice');
    expect(p.questions[2].type).toBe('score');
    expect(p.input).toContain('Parent:');
  });

  it('sends the shared rules to every question, matching the Jev adapter', () => {
    const p = buildOpenAIDecisionsPayload(post, {
      ...DEFAULT_SETTINGS,
      protocol: 'openai-decisions',
      defaultPrompt: '',
    });
    const [, kind, likelihood] = p.questions;

    expect(p.questions[0].instructions).toBe(DEFAULT_PROMPT);
    expect(kind.instructions).toBe(BAIT_KIND_INSTRUCTIONS);
    expect(likelihood.instructions).toBe(BOT_LIKELIHOOD_INSTRUCTIONS);
    const kindChoices = JSON.stringify(kind);
    expect(kindChoices).toContain('"value":"human"');
    expect(kindChoices).toContain('@bot');
    // Five levels, so `score / 4` keeps mapping to 0..1.
    expect(likelihood.type === 'score' && likelihood.levels).toHaveLength(5);
    expect(JSON.stringify(likelihood)).toContain('no concrete AI tell');
  });

  it('parses a real /v1/decisions response captured on 2026-10-31', () => {
    // Captured from POST https://api.openai.com/v1/decisions with
    // model gpt-6-luna and the payload this adapter builds.
    const { score, reason } = scoreFromOpenAIDecisions(realDecision);
    expect(reason).toContain('predicate=0.56');
    expect(reason).toContain('kind=praise_bot');
    // 0.55 * 0.56 + 0.45 * (1.98 / 4) ≈ 0.531, floored to 0.55 by the choice.
    expect(score).toBeCloseTo(0.55, 5);
  });

  it('scores from predicate probability', () => {
    const { score } = scoreFromOpenAIDecisions({
      answers: [
        { type: 'predicate', name: 'is_slop', probability: 0.8 },
        { type: 'choice', name: 'bait_kind', choice: 'promo' },
        { type: 'score', name: 'bot_likelihood', score: 3 },
      ],
    });
    expect(score).toBeGreaterThanOrEqual(0.75);
  });
});
