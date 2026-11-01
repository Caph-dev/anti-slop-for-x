import { describe, expect, it } from 'vitest';
import { decide, userRule } from '../lib/mode';
import { DEFAULT_SETTINGS } from '../lib/types';
import type { Recognition } from '../lib/recognition';

const context = { post: 'available', parent: 'available', root: 'missing', quote: 'not-applicable' } as const;
const result: Recognition = { status: 'classified', category: 'engagement_bait', reason: 'A lure', evidence: [{ source: 'post', quote: 'Reply YES' }], counterevidence: [], context };

describe('recognition presentation policy', () => {
  it('hard blocks model folding for shadow and old auto/strict modes', () => {
    for (const scanMode of ['shadow', 'auto-fold', 'strict'] as const) {
      expect(decide(result, { ...DEFAULT_SETTINGS, scanMode }, 'none')).toEqual({ presentation: 'none', counterfactual: 'fold', reason: 'automatic_folding_blocked' });
    }
  });
  it('manual offers reversible controls without automatic folding', () => {
    expect(decide(result, { ...DEFAULT_SETTINGS, scanMode: 'manual' }, 'none').presentation).toBe('advisory');
  });
  it('keep wins and shadow never changes post UI, including explicit hide rules', () => {
    expect(decide(result, { ...DEFAULT_SETTINGS, scanMode: 'manual' }, 'keep').presentation).toBe('none');
    expect(decide(result, { ...DEFAULT_SETTINGS, scanMode: 'manual' }, 'hide').presentation).toBe('fold');
    expect(decide(result, DEFAULT_SETTINGS, 'hide').presentation).toBe('none');
  });
  it('does not count a user hide rule as an automatic model prediction', () => {
    expect(decide(result, { ...DEFAULT_SETTINGS, scanMode: 'shadow' }, 'hide').counterfactual).toBe('keep');
    expect(decide(result, { ...DEFAULT_SETTINGS, scanMode: 'shadow' }, 'none').counterfactual).toBe('fold');
  });
  it('keeps an unknown account local when own-post skipping is enabled', () => {
    const prefs = { ...DEFAULT_SETTINGS, accountHideList: ['author'] };
    expect(userRule({ handle: 'author', isOwn: null }, prefs)).toBe('keep');
    expect(userRule({ handle: 'author', isOwn: false }, prefs)).toBe('hide');
  });
  it('preserves explicit rules when debug is enabled', () => {
    const debug = { ...DEFAULT_SETTINGS, scanMode: 'manual' as const, debugMode: true };
    expect(decide(result, debug, 'keep').presentation).toBe('none');
    expect(decide(result, debug, 'hide').presentation).toBe('fold');
    expect(decide(result, debug, 'none').presentation).toBe('diagnostic');
  });
  it('fail-open and debug do not convert uncertainty into a target', () => {
    const failed: Recognition = { status: 'failed', error: 'rate_limited', context };
    expect(decide(failed, { ...DEFAULT_SETTINGS, scanMode: 'manual' }, 'none').presentation).toBe('none');
    expect(decide(failed, { ...DEFAULT_SETTINGS, scanMode: 'manual', debugMode: true }, 'none').presentation).toBe('diagnostic');
    expect(decide(failed, { ...DEFAULT_SETTINGS, debugMode: true }, 'none').presentation).toBe('none');
  });
});
