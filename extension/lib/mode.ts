/**
 * What the extension does with a scored post, per scan mode.
 *
 * Pure decision logic — no DOM, no storage — so the thresholds are testable.
 *
 * - manual:    never hide anything; show the AI rate and let the user act
 * - auto-fold: fold replies at or above the fold threshold (default)
 * - strict:    fold as usual, and block the author above the strict threshold
 */
import type { DecisionResult, ScanMode, Settings } from './types';

export type Presentation = 'fold' | 'advisory' | 'badge' | 'none';

export interface Decision {
  presentation: Presentation;
  /** True when the author should be blocked automatically (strict mode). */
  autoBlock: boolean;
}

/** Strict mode never blocks below this score, whatever the fold threshold is. */
export const STRICT_BLOCK_MIN_SCORE = 0.9;

export type ModeSettings = Pick<Settings, 'scanMode' | 'threshold'>;

export function strictBlockThreshold(settings: Pick<Settings, 'threshold'>): number {
  return Math.max(STRICT_BLOCK_MIN_SCORE, settings.threshold);
}

/**
 * Auto-blocking is destructive and cannot be undone from the extension yet, so
 * it requires evidence from the decision model. Prefilter-only scores, the
 * `prefilterOnly` setting and the model-error fallback produce numbers from
 * local regexes alone — those may fold, never block.
 */
export function hasModelEvidence(result: Pick<DecisionResult, 'evidence'>): boolean {
  return result.evidence === 'model';
}

export function decide(
  result: Pick<DecisionResult, 'score' | 'source' | 'evidence'>,
  settings: ModeSettings,
): Decision {
  if (result.source === 'skipped') return { presentation: 'none', autoBlock: false };

  const score = result.score;
  const threshold = settings.threshold;
  const mode: ScanMode = settings.scanMode;

  if (mode === 'strict' && score >= strictBlockThreshold(settings)) {
    return { presentation: 'fold', autoBlock: hasModelEvidence(result) };
  }
  if (score >= threshold) {
    return { presentation: mode === 'manual' ? 'advisory' : 'fold', autoBlock: false };
  }
  // Borderline: mark it, never hide it.
  if (score >= threshold * 0.7) return { presentation: 'badge', autoBlock: false };
  return { presentation: 'none', autoBlock: false };
}
