/**
 * Guard rails for automatic (destructive) actions.
 *
 * Auto-blocking fires from a scrolling timeline, so without limits a bot-heavy
 * thread can burst dozens of v1.1 requests and trip X's abuse detection. The
 * state lives in `chrome.storage.local` so it survives reloads and is shared by
 * every tab.
 *
 * Writes are read-modify-write; two tabs racing at the exact same moment can
 * under-count. That is acceptable here: the cap is a safety margin, not an
 * accounting system, and a single tab is the normal case.
 */

const KEY = 'antiSlopAutoGuard';

/** Minimum gap between two automatic actions. */
export const MIN_INTERVAL_MS = 20_000;
/** Hard cap per local day. */
export const DAILY_CAP = 30;
/** How long we stop automatic actions after X answers 429/403. */
export const MELTDOWN_MS = 60 * 60 * 1000;
/** How long a handled account stays remembered. */
export const HANDLED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface GuardState {
  lastAt: number;
  dayKey: string;
  dayCount: number;
  pausedUntil: number;
  /** key (userId or handle) → ms timestamp of the automatic action */
  handled: Record<string, number>;
}

export const EMPTY_GUARD: GuardState = {
  lastAt: 0,
  dayKey: '',
  dayCount: 0,
  pausedUntil: 0,
  handled: {},
};

export function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export interface GuardVerdict {
  allowed: boolean;
  reason?: 'paused' | 'cooldown' | 'daily-cap';
  /** ms until the guard would allow the next action (0 when allowed). */
  waitMs: number;
}

/** Pure check, so the limits are testable without storage. */
export function evaluateGuard(state: GuardState, now: number): GuardVerdict {
  if (state.pausedUntil > now) {
    return { allowed: false, reason: 'paused', waitMs: state.pausedUntil - now };
  }
  const since = now - state.lastAt;
  if (since < MIN_INTERVAL_MS) {
    return { allowed: false, reason: 'cooldown', waitMs: MIN_INTERVAL_MS - since };
  }
  const today = dayKeyOf(now);
  const count = state.dayKey === today ? state.dayCount : 0;
  if (count >= DAILY_CAP) {
    return { allowed: false, reason: 'daily-cap', waitMs: 0 };
  }
  return { allowed: true, waitMs: 0 };
}

export function pruneHandled(
  handled: Record<string, number>,
  now: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, ts] of Object.entries(handled)) {
    if (now - ts < HANDLED_TTL_MS) out[key] = ts;
  }
  return out;
}

export async function readGuard(): Promise<GuardState> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = stored[KEY] as Partial<GuardState> | undefined;
  if (!raw || typeof raw !== 'object') return { ...EMPTY_GUARD, handled: {} };
  return {
    lastAt: Number(raw.lastAt) || 0,
    dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : '',
    dayCount: Number(raw.dayCount) || 0,
    pausedUntil: Number(raw.pausedUntil) || 0,
    handled: raw.handled && typeof raw.handled === 'object' ? raw.handled : {},
  };
}

async function writeGuard(state: GuardState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: state });
}

/** Reserve the right to perform one automatic action right now. */
export async function reserveAutoAction(
  now: number,
): Promise<{ ok: boolean; verdict: GuardVerdict }> {
  const state = await readGuard();
  const verdict = evaluateGuard(state, now);
  if (!verdict.allowed) return { ok: false, verdict };

  const today = dayKeyOf(now);
  await writeGuard({
    ...state,
    lastAt: now,
    dayKey: today,
    dayCount: (state.dayKey === today ? state.dayCount : 0) + 1,
  });
  return { ok: true, verdict };
}

/** Remember an account, so other tabs / page reloads do not act on it again. */
export async function markHandled(key: string, now: number): Promise<void> {
  const state = await readGuard();
  const handled = pruneHandled(state.handled, now);
  handled[key] = now;
  await writeGuard({ ...state, handled });
}

export async function isHandled(key: string, now: number): Promise<boolean> {
  const state = await readGuard();
  const ts = state.handled[key];
  return typeof ts === 'number' && now - ts < HANDLED_TTL_MS;
}

/** Stop automatic actions for a while (X answered 429/403). */
export async function pauseAutoActions(until: number): Promise<void> {
  const state = await readGuard();
  await writeGuard({ ...state, pausedUntil: until });
}

export function guardKey(): string {
  return KEY;
}
