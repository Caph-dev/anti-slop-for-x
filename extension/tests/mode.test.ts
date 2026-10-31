import { describe, expect, it } from 'vitest';
import {
  STRICT_BLOCK_MIN_SCORE,
  STRICT_ENABLED,
  decide,
  strictBlockThreshold,
} from '../lib/mode';
import type { Settings } from '../lib/types';

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...({} as Settings),
    scanMode: 'auto-fold',
    threshold: 0.55,
    ...overrides,
  };
}

const source = 'model' as const;
const modelEvidence = 'model' as const;
const prefilterEvidence = 'prefilter' as const;

describe('decide — auto-fold (default)', () => {
  it('folds at or above the threshold and never blocks', () => {
    const d = decide({ score: 0.55, source, evidence: modelEvidence }, settings());
    expect(d).toEqual({ presentation: 'fold', autoBlock: false });
  });

  it('badges the borderline band between 70% and 100% of the threshold', () => {
    // 0.55 * 0.7 = 0.385
    expect(decide({ score: 0.39, source, evidence: modelEvidence }, settings()).presentation).toBe('badge');
    expect(decide({ score: 0.38, source, evidence: modelEvidence }, settings()).presentation).toBe('none');
  });

  it('ignores skipped results', () => {
    expect(decide({ score: 1, source: 'skipped', evidence: undefined }, settings())).toEqual({
      presentation: 'none',
      autoBlock: false,
    });
  });
});

describe('decide — manual', () => {
  it('shows an advisory card instead of folding', () => {
    const d = decide({ score: 0.8, source, evidence: modelEvidence }, settings({ scanMode: 'manual' }));
    expect(d).toEqual({ presentation: 'advisory', autoBlock: false });
  });

  it('still badges the borderline band', () => {
    expect(decide({ score: 0.4, source, evidence: modelEvidence }, settings({ scanMode: 'manual' })).presentation).toBe(
      'badge',
    );
  });

  it('never auto-blocks', () => {
    expect(decide({ score: 1, source, evidence: modelEvidence }, settings({ scanMode: 'manual' })).autoBlock).toBe(false);
  });
});

describe('decide — strict is shelved', () => {
  it('never auto-blocks while the feature is off', () => {
    const s = settings({ scanMode: 'strict' });
    expect(decide({ score: 1, source, evidence: modelEvidence }, s)).toEqual({
      presentation: 'fold',
      autoBlock: false,
    });
  });

  it('treats a forced strict value as auto-fold', () => {
    const s = settings({ scanMode: 'strict' });
    expect(decide({ score: 0.4, source, evidence: modelEvidence }, s).presentation).toBe('badge');
    expect(decide({ score: 0.9, source, evidence: modelEvidence }, s).presentation).toBe('fold');
  });
});

describe.skipIf(STRICT_ENABLED)('decide — strict (rewritten when the feature returns)', () => {
  // These assert the intended behaviour, not the shipped one.
  it('is skipped while STRICT_ENABLED is false', () => {
    expect(STRICT_ENABLED).toBe(false);
  });
});

// The assertions below describe the feature as designed. They stay here so the
// work is not lost, and they run again when STRICT_ENABLED flips to true.
describe.skipIf(!STRICT_ENABLED)('decide — strict', () => {
  it('folds between the fold threshold and the strict threshold', () => {
    const d = decide({ score: 0.7, source, evidence: modelEvidence }, settings({ scanMode: 'strict' }));
    expect(d).toEqual({ presentation: 'fold', autoBlock: false });
  });

  it('blocks at the strict threshold', () => {
    const d = decide({ score: STRICT_BLOCK_MIN_SCORE, source, evidence: modelEvidence }, settings({ scanMode: 'strict' }));
    expect(d).toEqual({ presentation: 'fold', autoBlock: true });
  });

  it('keeps the strict floor even with a low fold threshold', () => {
    const s = settings({ scanMode: 'strict', threshold: 0.3 });
    expect(strictBlockThreshold(s)).toBe(0.9);
    expect(decide({ score: 0.5, source, evidence: modelEvidence }, s).autoBlock).toBe(false);
    expect(decide({ score: 0.9, source, evidence: modelEvidence }, s).autoBlock).toBe(true);
  });

  it('never auto-blocks without model evidence, however high the score', () => {
    const s = settings({ scanMode: 'strict' });
    const d = decide({ score: 1, source: 'prefilter', evidence: prefilterEvidence }, s);
    expect(d).toEqual({ presentation: 'fold', autoBlock: false });
  });

  it('auto-blocks a cached score that came from the model', () => {
    // cache rewrites `source` but the evidence tag survives.
    const d = decide({ score: 0.95, source: 'cache', evidence: modelEvidence }, settings({ scanMode: 'strict' }));
    expect(d.autoBlock).toBe(true);
  });

  it('never blocks below a user threshold that is already above the floor', () => {
    const s = settings({ scanMode: 'strict', threshold: 0.95 });
    expect(strictBlockThreshold(s)).toBe(0.95);
    expect(decide({ score: 0.92, source, evidence: modelEvidence }, s).autoBlock).toBe(false);
    expect(decide({ score: 0.96, source, evidence: modelEvidence }, s).autoBlock).toBe(true);
  });
});
