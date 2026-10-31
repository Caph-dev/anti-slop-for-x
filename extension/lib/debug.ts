/**
 * Debug mode: a read-only AI rate on every post in the page.
 *
 * Debug is diagnostic, so it must not change what the normal pipeline does:
 * - the scoring settings bypass the noise skips (short text / own posts /
 *   whitelist), otherwise every one of them would show a skipped `0%` instead
 *   of the number the detector actually computed;
 * - results go to their own cache namespace, so a debug score can never be read
 *   back by the fold path (a whitelisted account must stay out of reach);
 * - nothing is folded or blocked while debug is on (enforced in the content
 *   script, which never reaches `decide()` in debug mode).
 */
import type { DecisionResult, Settings } from './types';

export type DebugLevel = 'low' | 'mid' | 'high';

export type DebugSourceKey =
  | 'srcModel'
  | 'srcPrefilter'
  | 'srcCache'
  | 'srcSkipped'
  | 'srcError';

export interface DebugLabel {
  pct: number;
  /** Mirrors the normal policy bands: high would fold, mid is borderline. */
  level: DebugLevel;
  /** uiT key for the score source, shown next to the percentage. */
  sourceKey: DebugSourceKey;
  /** Hover text: the decision reason plus the prefilter hits that fired. */
  detail: string;
}

/** Settings used only to *score* in debug mode; never written back or acted on. */
export function debugScoringSettings(settings: Settings): Settings {
  return {
    ...settings,
    skipShortText: false,
    skipOwnPosts: false,
    accountWhitelist: [],
  };
}

/** Debug results live apart from the normal cache, in both directions. */
export function debugCacheKey(postId: string): string {
  return `debug:${postId}`;
}

export function debugSourceKey(
  result: Pick<DecisionResult, 'source' | 'reason'>,
): DebugSourceKey {
  if (result.source === 'model') return 'srcModel';
  if (result.source === 'cache') return 'srcCache';
  if (result.source === 'skipped') return 'srcSkipped';
  return /^model-error/.test(result.reason || '') ? 'srcError' : 'srcPrefilter';
}

export function debugScoreLabel(
  result: Pick<DecisionResult, 'score' | 'source' | 'reason' | 'prefilter'>,
  threshold: number,
): DebugLabel {
  const score = Math.max(0, Math.min(1, result.score));
  const level: DebugLevel =
    score >= threshold ? 'high' : score >= threshold * 0.7 ? 'mid' : 'low';

  const hits = result.prefilter?.hits ?? [];
  const detail = [
    result.reason || '',
    hits.length
      ? `prefilter: ${hits
          .map((h) => `${h.id}${h.detail ? ` (${h.detail})` : ''}`)
          .join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    pct: Math.round(score * 100),
    level,
    sourceKey: debugSourceKey(result),
    detail,
  };
}
