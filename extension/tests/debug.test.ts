import { describe, expect, it } from 'vitest';
import {
  debugBadgeText,
  debugCacheKey,
  debugScoreLabel,
  debugScoringSettings,
  debugSourceKey,
} from '../lib/debug';
import { scorePost } from '../lib/scorer';
import { getCached } from '../lib/cache';
import { DEFAULT_SETTINGS, type DecisionResult, type Settings } from '../lib/types';

function settings(partial: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...partial };
}

function label(
  score: number,
  source: DecisionResult['source'],
  reason = '',
  prefilter?: DecisionResult['prefilter'],
  modelScore?: number,
) {
  return debugScoreLabel({ score, modelScore, source, reason, prefilter }, 0.55);
}

const t = (key: string) => key;

describe('debug scoring settings', () => {
  it('bypasses every noise skip so each post gets a real score', () => {
    const normal = settings({
      skipShortText: true,
      skipOwnPosts: true,
      accountWhitelist: ['alice'],
    });
    const debugged = debugScoringSettings(normal);

    expect(debugged.skipShortText).toBe(false);
    expect(debugged.skipOwnPosts).toBe(false);
    expect(debugged.accountWhitelist).toEqual([]);
    // The user's model choices still apply, including the cost saving opt-out.
    expect(debugged.prefilterOnly).toBe(normal.prefilterOnly);
    expect(debugged.threshold).toBe(normal.threshold);
    expect(debugged.model).toBe(normal.model);
    // The caller's object is never mutated.
    expect(normal.skipShortText).toBe(true);
    expect(normal.accountWhitelist).toEqual(['alice']);
  });

  it('scores a whitelisted short post that the normal pipeline skips', async () => {
    const base = settings({ prefilterOnly: true, skipShortText: true });
    const post = {
      id: 'debug-scores-what-normal-skips',
      handle: 'alice',
      text: 'Great point!',
      isReply: true,
    };

    const normal = await scorePost(post, { ...base, accountWhitelist: ['alice'] });
    expect(normal.source).toBe('skipped');
    expect(normal.score).toBe(0);

    const debugged = await scorePost(post, debugScoringSettings(base), {
      cacheKey: debugCacheKey(post.id),
    });
    expect(debugged.source).toBe('prefilter');
    expect(debugged.score).toBeGreaterThan(0);
    // No model ran, so there is no model score to display.
    expect(debugged.modelScore).toBeUndefined();
  });

  it('keeps debug scores out of the normal cache', async () => {
    const base = settings({ prefilterOnly: true, skipShortText: true });
    const post = { id: 'debug-cache-isolation', handle: 'bob', text: 'Okay', isReply: true };

    await scorePost(post, debugScoringSettings(base), {
      cacheKey: debugCacheKey(post.id),
    });

    // The fold path must still see its own skipped result, not the debug score.
    const normal = await scorePost(post, base);
    expect(normal.source).toBe('skipped');
    expect(normal.score).toBe(0);
  });

  it('drops the cache write when the request went stale', async () => {
    const base = settings({ prefilterOnly: true });
    const stale = { id: 'debug-stale-score', handle: 'dave', text: 'Great point!', isReply: true };
    const fresh = { id: 'debug-fresh-score', handle: 'erin', text: 'Great point!', isReply: true };

    await scorePost(stale, base, { shouldCache: () => false });
    expect(getCached(stale.id)).toBeUndefined();

    await scorePost(fresh, base);
    expect(getCached(fresh.id)).toBeDefined();
  });

  it('labels debug cache hits as cached scores', async () => {
    const base = settings({ prefilterOnly: true });
    const post = { id: 'debug-cache-hit', handle: 'carol', text: 'Great point!', isReply: true };
    const key = debugCacheKey(post.id);

    await scorePost(post, debugScoringSettings(base), { cacheKey: key });
    const again = await scorePost(post, debugScoringSettings(base), { cacheKey: key });

    expect(debugSourceKey(again)).toBe('srcCache');
  });
});

describe('debug score labels', () => {
  it('mirrors the normal policy bands', () => {
    expect(label(0.9, 'model').level).toBe('high');
    expect(label(0.55, 'model').level).toBe('high');
    expect(label(0.54, 'model').level).toBe('mid');
    expect(label(0.385, 'model').level).toBe('mid');
    expect(label(0.38, 'model').level).toBe('low');
    expect(label(0, 'model').level).toBe('low');
  });

  it('rounds the percentage and clamps out-of-range scores', () => {
    expect(label(0.424, 'model').pct).toBe(42);
    expect(label(1.8, 'model').pct).toBe(100);
    expect(label(-0.2, 'model').pct).toBe(0);
  });

  it('distinguishes where the number came from', () => {
    expect(label(0.4, 'model').sourceKey).toBe('srcModel');
    expect(label(0.4, 'prefilter').sourceKey).toBe('srcPrefilter');
    expect(label(0.4, 'cache').sourceKey).toBe('srcCache');
    expect(label(0.4, 'skipped').sourceKey).toBe('srcSkipped');
    expect(label(0.4, 'prefilter', 'model-error→prefilter:none').sourceKey).toBe('srcError');
  });

  it('carries the model score separately from the final score', () => {
    const withModel = label(0.47, 'model', 'model:predicate=0.56', undefined, 0.56);
    expect(withModel.modelPct).toBe(56);
    expect(withModel.pct).toBe(47);

    // Prefilter-only and model-error results have no model number.
    expect(label(0.42, 'prefilter').modelPct).toBeNull();
    expect(label(0.42, 'prefilter', 'model-error→prefilter:none').modelPct).toBeNull();

    // A cached model result keeps the number it was computed with.
    const cached = debugScoreLabel(
      { score: 0.47, modelScore: 0.56, source: 'cache', reason: 'model:x', prefilter: undefined },
      0.55,
    );
    expect(cached.modelPct).toBe(56);
    expect(cached.pct).toBe(47);
  });

  it('renders model | final, with a dash when no model ran', () => {
    expect(debugBadgeText(label(0.47, 'model', 'model:x', undefined, 0.56), t)).toBe(
      'AI 56% | 47%',
    );
    expect(debugBadgeText(label(0.42, 'prefilter'), t)).toBe('AI – | 42% · srcPrefilter');
    expect(
      debugBadgeText(label(0.42, 'cache', 'model:x', undefined, 0.56), t),
    ).toBe('AI 56% | 42% · srcCache');
  });

  it('only annotates sources that are not a fresh model score', () => {
    // `AI 42%` for the default path; the rest say why the number is not one.
    expect(label(0.4, 'model').showSource).toBe(false);
    expect(label(0.4, 'prefilter').showSource).toBe(true);
    expect(label(0.4, 'cache').showSource).toBe(true);
    expect(label(0.4, 'skipped').showSource).toBe(true);
    expect(label(0.4, 'prefilter', 'model-error→prefilter:none').showSource).toBe(true);
  });

  it('exposes the reason and the prefilter hits in the hover text', () => {
    const hit = label(0.6, 'model', 'model:clear bot; pre=0.62', {
      score: 0.62,
      hits: [{ id: 'great_point', weight: 0.22, detail: 'x' }],
      decisive: false,
      skipModel: false,
    });
    expect(hit.detail).toContain('model:clear bot');
    expect(hit.detail).toContain('great_point');
  });
});
