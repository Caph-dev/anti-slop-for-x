import { describe, expect, it } from 'vitest';
import { buildJevPayload, scoreFromJev } from '../lib/adapters/jev';
import {
  buildOpenAIDecisionsPayload,
  scoreFromOpenAIDecisions,
} from '../lib/adapters/openai-decisions';
import { DEFAULT_SETTINGS } from '../lib/types';

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
