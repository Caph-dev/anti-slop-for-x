/**
 * The invalidation guards are only useful if the *real* scorer honours them:
 * a model response that arrives after the settings changed must not be cached.
 * `scan-state.test.ts` covers the state machine with a counter; this file uses
 * `scorePost` itself with a controllable upstream.
 */
import { describe, expect, it } from 'vitest';
import { scorePost } from '../lib/scorer';
import { getCached } from '../lib/cache';
import { DEFAULT_SETTINGS, type PostExtract, type Settings } from '../lib/types';

const DECISION = {
  answers: [
    { type: 'predicate', name: 'is_slop', probability: 0.4 },
    { type: 'choice', name: 'bait_kind', choice: 'human' },
    { type: 'score', name: 'bot_likelihood', score: 1 },
  ],
};

const POST: PostExtract = {
  id: 'score-invalidation-post',
  handle: 'frank',
  text: 'Solid writeup with real specifics',
  isReply: true,
};

const SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  protocol: 'openai-decisions',
  model: 'gpt-6-luna',
  apiKey: 'test-key',
  // No prefire hit, so this post goes to the model.
  prefilterOnly: false,
};

/** Fake background worker whose reply we release by hand. */
function installDeferredWorker() {
  let respond!: (value: unknown) => void;
  const reply = new Promise<unknown>((resolve) => {
    respond = resolve;
  });
  const calls: unknown[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: (msg: unknown) => {
        calls.push(msg);
        return reply;
      },
    },
  };
  return {
    calls,
    respond: () => respond({ ok: true, raw: DECISION }),
  };
}

describe('scorePost invalidation', () => {
  it('does not cache a model score that resolves after the policy changed', async () => {
    const worker = installDeferredWorker();
    let current = true;
    const key = 'mid-flight-stale';

    const pending = scorePost(POST, SETTINGS, { cacheKey: key, shouldCache: () => current });
    // The user flips debug mode or changes the model while the request is out.
    current = false;
    worker.respond();
    const result = await pending;

    expect(worker.calls).toHaveLength(1);
    expect(result.source).toBe('model');
    expect(getCached(key)).toBeUndefined();
    // predicate 0.4 + bot_likelihood 1/4, choice human: 0.55*0.4 + 0.45*0.25.
    expect(result.modelScore).toBeCloseTo(0.3325, 5);
    // Nothing in the prefilter fired, so the final score is the model score.
    expect(result.score).toBeCloseTo(0.3325, 5);
  });

  it('caches the same model score while the policy is still current', async () => {
    const worker = installDeferredWorker();
    const key = 'mid-flight-current';

    const pending = scorePost(POST, SETTINGS, { cacheKey: key, shouldCache: () => true });
    worker.respond();
    const result = await pending;

    expect(result.source).toBe('model');
    expect(getCached(key)).toBeDefined();
    expect(result.modelScore).toBeCloseTo(0.3325, 5);
    expect(result.score).toBeCloseTo(0.3325, 5);
  });
});
