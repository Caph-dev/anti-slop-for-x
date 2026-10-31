import { describe, expect, it } from 'vitest';
import {
  DAILY_CAP,
  EMPTY_GUARD,
  MIN_INTERVAL_MS,
  dayKeyOf,
  evaluateGuard,
  pruneHandled,
  type GuardState,
} from '../lib/auto-guard';

const NOW = 1_700_000_000_000;

function state(overrides: Partial<GuardState> = {}): GuardState {
  return { ...EMPTY_GUARD, handled: {}, ...overrides };
}

describe('evaluateGuard', () => {
  it('allows the first action', () => {
    expect(evaluateGuard(state(), NOW)).toEqual({ allowed: true, waitMs: 0 });
  });

  it('enforces the cooldown between actions', () => {
    const s = state({ lastAt: NOW - 5_000, dayKey: dayKeyOf(NOW), dayCount: 1 });
    const v = evaluateGuard(s, NOW);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('cooldown');
    expect(v.waitMs).toBe(MIN_INTERVAL_MS - 5_000);
  });

  it('allows again once the cooldown has passed', () => {
    const s = state({ lastAt: NOW - MIN_INTERVAL_MS, dayKey: dayKeyOf(NOW), dayCount: 1 });
    expect(evaluateGuard(s, NOW).allowed).toBe(true);
  });

  it('stops at the daily cap', () => {
    const s = state({ dayKey: dayKeyOf(NOW), dayCount: DAILY_CAP, lastAt: NOW - MIN_INTERVAL_MS });
    const v = evaluateGuard(s, NOW);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('daily-cap');
  });

  it('resets the cap on a new day', () => {
    const s = state({ dayKey: '2000-01-01', dayCount: DAILY_CAP, lastAt: NOW - MIN_INTERVAL_MS });
    expect(evaluateGuard(s, NOW).allowed).toBe(true);
  });

  it('honours a meltdown pause above everything else', () => {
    const s = state({ pausedUntil: NOW + 60_000, lastAt: 0 });
    const v = evaluateGuard(s, NOW);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('paused');
  });

  it('allows again after the pause expires', () => {
    const s = state({ pausedUntil: NOW - 1, lastAt: NOW - MIN_INTERVAL_MS });
    expect(evaluateGuard(s, NOW).allowed).toBe(true);
  });
});

describe('pruneHandled', () => {
  it('drops entries older than the TTL and keeps fresh ones', () => {
    const old = NOW - 8 * 24 * 60 * 60 * 1000;
    const fresh = NOW - 1000;
    const out = pruneHandled({ stale: old, fresh }, NOW);
    expect(out).toEqual({ fresh });
  });
});
