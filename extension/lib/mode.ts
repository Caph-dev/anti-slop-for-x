/**
 * What a recognition does to a post, given the user's settings and rules.
 *
 * Pure decision logic, no DOM or storage, so the guarantees are testable:
 * - nothing a model returns can fold a post. There is no launch switch:
 *   automatic model folding needs a future, independently reviewed change;
 * - `shadow` (and the legacy `auto-fold` / `strict` modes) never change a post;
 * - a keep rule wins every conflict; a hide rule is a local, reversible fold;
 * - failures, abstentions and unavailable states fail open (nothing shown,
 *   except a diagnostic badge when debug is on in manual mode).
 */
import { isTarget, type Recognition } from './recognition';
import type { ScanMode, Settings } from './types';

export type UserRule = 'keep' | 'hide' | 'none';
export type Presentation = 'none' | 'advisory' | 'diagnostic' | 'fold';
export type DecisionReason =
  | 'disabled' | 'shadow' | 'automatic_folding_blocked' | 'user_keep' | 'debug'
  | 'user_hide' | 'manual_review' | 'disputed' | 'normal' | 'fail_open';
/**
 * `counterfactual` is what a fold-everything-flagged policy would have done.
 * Shadow records it; nothing acts on it.
 */
export interface Decision { presentation: Presentation; counterfactual: 'keep' | 'fold'; reason: DecisionReason }

export interface RuleSubject { handle: string; isOwn?: boolean | null }

function sameHandle(list: string[], handle: string): boolean {
  return list.some((h) => h.replace(/^@/, '').toLowerCase() === handle);
}

export function userRule(post: RuleSubject, settings: Pick<Settings, 'accountWhitelist' | 'accountHideList' | 'skipOwnPosts'>): UserRule {
  const handle = post.handle.replace(/^@/, '').toLowerCase();
  if (sameHandle(settings.accountWhitelist, handle) || (settings.skipOwnPosts && post.isOwn !== false)) return 'keep';
  if (sameHandle(settings.accountHideList, handle)) return 'hide';
  return 'none';
}

/** Legacy automatic modes are read as shadow. */
export function effectiveMode(mode: ScanMode): 'manual' | 'shadow' {
  return mode === 'manual' ? 'manual' : 'shadow';
}

export function decide(
  result: Recognition,
  settings: Pick<Settings, 'enabled' | 'scanMode' | 'debugMode'>,
  rule: UserRule,
  options: { disputed?: boolean } = {},
): Decision {
  const target = isTarget(result);
  const counterfactual = rule === 'none' && target ? 'fold' : 'keep';
  const decision = (presentation: Presentation, reason: DecisionReason): Decision => {
    // Hard guard: only the user's own hide rule may fold a post.
    if (presentation === 'fold' && rule !== 'hide') presentation = 'advisory';
    return { presentation, counterfactual, reason };
  };
  if (!settings.enabled) return decision('none', 'disabled');
  if (effectiveMode(settings.scanMode) !== 'manual') return decision('none', target ? 'automatic_folding_blocked' : 'shadow');
  if (rule === 'keep') return decision('none', 'user_keep');
  if (rule === 'hide') return decision('fold', 'user_hide');
  if (settings.debugMode) return decision('diagnostic', 'debug');
  if (target) return options.disputed ? decision('none', 'disputed') : decision('advisory', 'manual_review');
  return decision('none', result.status === 'classified' ? 'normal' : 'fail_open');
}
