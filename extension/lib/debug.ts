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
  /** Final score, the one the normal policy acts on. */
  pct: number;
  /** Decision-model score before the blend; null when the model did not run. */
  modelPct: number | null;
  /** Mirrors the normal policy bands: high would fold, mid is borderline. */
  level: DebugLevel;
  /** Where the number came from; kept for the tooltip and the dataset. */
  sourceKey: DebugSourceKey;
  /**
   * The model is the default producer, so naming it adds nothing to the common
   * case. Prefilter, cache and failure are worth showing: they say the number
   * is not a fresh model judgement.
   */
  showSource: boolean;
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
  result: Pick<DecisionResult, 'score' | 'modelScore' | 'source' | 'reason' | 'prefilter'>,
  threshold: number,
): DebugLabel {
  const score = clamp01(result.score);
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

  const sourceKey = debugSourceKey(result);
  return {
    pct: Math.round(score * 100),
    modelPct: typeof result.modelScore === 'number' ? Math.round(clamp01(result.modelScore) * 100) : null,
    level,
    sourceKey,
    showSource: sourceKey !== 'srcModel',
    detail,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * `AI 56% | 47%`: the decision-model score first, then the final blended score
 * the policy acts on. A prefilter-only result has no model number, shown as
 * `–` rather than pretending the prefilter score came from the model.
 */
export function debugBadgeText(
  label: Pick<DebugLabel, 'pct' | 'modelPct' | 'showSource' | 'sourceKey'>,
  t: (key: string) => string,
): string {
  const model = label.modelPct == null ? '–' : `${label.modelPct}%`;
  const source = label.showSource ? ` · ${t(label.sourceKey)}` : '';
  return `AI ${model} | ${label.pct}%${source}`;
}
