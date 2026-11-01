import { describe, expect, it } from 'vitest';
import { applyRuleEdits, diffRuleEdits, parseRuleEdits } from '../lib/account-rules';

const handles = ['alpha', 'beta', 'gamma'];
const subset = (mask: number) => handles.filter((_, index) => (mask & (1 << index)) !== 0);
const lists = (accountWhitelist: string[]) => ({ accountWhitelist, accountHideList: [] });

describe('account rule edits', () => {
  it('applies only the user edits and preserves unrelated concurrent changes', () => {
    for (let originalMask = 0; originalMask < 8; originalMask++) {
      for (let editedMask = 0; editedMask < 8; editedMask++) {
        for (let currentMask = 0; currentMask < 8; currentMask++) {
          const original = subset(originalMask);
          const edited = subset(editedMask);
          const current = subset(currentMask);
          const result = applyRuleEdits(lists(current), diffRuleEdits(lists(original), lists(edited)));
          const final = result.accountWhitelist ?? current;
          for (const handle of handles) {
            const explicitlyAdded = !original.includes(handle) && edited.includes(handle);
            const explicitlyRemoved = original.includes(handle) && !edited.includes(handle);
            expect(final.includes(handle)).toBe(explicitlyAdded || (!explicitlyRemoved && current.includes(handle)));
          }
          expect(current).toEqual(subset(currentMask));
        }
      }
    }
  });

  it('matches handles case-insensitively and ignores a leading at sign', () => {
    const original = lists(['Alpha']);
    const edited = lists(['@ALPHA', 'Beta']);
    const current = lists(['alpha', 'BETA']);
    const result = applyRuleEdits(current, diffRuleEdits(original, edited));
    expect(result.accountWhitelist).toEqual(['alpha', 'BETA']);
  });

  it('deduplicates edit operations by case-insensitive handle', () => {
    const original = lists(Array(10_001).fill('alpha'));
    const edits = diffRuleEdits(original, lists([]));
    expect(edits.accountWhitelist?.remove.length).toBe(1);
    expect(edits.accountWhitelist?.remove[0]).toBe('alpha');
    expect(parseRuleEdits(edits)).not.toBeNull();
    expect(applyRuleEdits(original, edits).accountWhitelist).toEqual([]);
  });

  it('applies an explicit removal of the same handle after a concurrent keep', () => {
    const edits = diffRuleEdits(lists(['alpha']), lists([]));
    expect(applyRuleEdits(lists(['alpha']), edits).accountWhitelist).toEqual([]);
  });

  it('rejects conflicting, malformed or oversized external edits', () => {
    expect(parseRuleEdits(undefined)).toEqual({});
    expect(parseRuleEdits({ accountWhitelist: { add: ['alice'], remove: ['@ALICE'] } })).toBeNull();
    expect(parseRuleEdits({ accountWhitelist: { add: ['alice'], remove: [], unexpected: true } })).toBeNull();
    expect(parseRuleEdits({ accountWhitelist: { add: Array(5001).fill('alice'), remove: [] } })).toBeNull();
    expect(parseRuleEdits({ accountWhitelist: { add: [{ handle: 'alice' }], remove: [] } })).toBeNull();
    expect(parseRuleEdits({ accountWhitelist: { add: ['a'.repeat(201)], remove: [] } })).toBeNull();
    expect(parseRuleEdits({ accountWhitelist: { add: ['Alice Smith'], remove: [] } })).toBeNull();
    expect(parseRuleEdits({ accountWhitelist: { add: [], remove: ['x'.repeat(201), 'x'.repeat(100_001)] } })).not.toBeNull();
    expect(parseRuleEdits({ credentialRevision: { add: [], remove: [] } })).toBeNull();
  });
});
