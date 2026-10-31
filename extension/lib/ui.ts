/** Fold / badge / Mute-Block UI injected into X tweets */

import type { DecisionResult } from './types';
import { debugScoreLabel } from './debug';

const ROOT_ATTR = 'data-anti-slop';
/** Post id the card was rendered for; X reuses article nodes across posts. */
const POST_ATTR = 'data-anti-slop-post';
const FOLDED_CLASS = 'anti-slop-folded';
const STYLE_ID = 'anti-slop-styles';

export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.${FOLDED_CLASS} > *:not(.anti-slop-bar) { display: none !important; }
.anti-slop-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 10px 12px; margin: 4px 0; border-radius: 12px;
  background: rgba(120,120,120,0.12); font-size: 13px; line-height: 1.3;
  color: inherit; font-family: system-ui, -apple-system, sans-serif;
}
.anti-slop-bar .ss-score { font-weight: 600; opacity: 0.9; }
.anti-slop-bar button {
  border: 1px solid rgba(127,127,127,0.4); background: transparent; color: inherit;
  border-radius: 999px; padding: 4px 10px; cursor: pointer; font-size: 12px;
}
.anti-slop-bar button:hover { background: rgba(127,127,127,0.15); }
.anti-slop-bar button.ss-danger:hover { border-color: #f4212e; color: #f4212e; }
.anti-slop-badge {
  display: inline-flex; align-items: center; gap: 4px;
  margin-left: 8px; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  background: rgba(244, 33, 46, 0.12); color: #f4212e;
}
.anti-slop-badge.ss-warn { background: rgba(255, 173, 31, 0.18); color: #cc8b00; }
.anti-slop-pill { cursor: pointer; }
.anti-slop-pill:hover { filter: brightness(1.15); }
.anti-slop-debug {
  display: inline-flex; align-items: center; gap: 4px;
  margin-left: 8px; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  background: rgba(127,127,127,0.16); color: inherit;
  font-variant-numeric: tabular-nums;
}
.anti-slop-debug.ss-high { background: rgba(244, 33, 46, 0.16); color: #f4212e; }
.anti-slop-debug.ss-mid { background: rgba(255, 173, 31, 0.2); color: #cc8b00; }
.anti-slop-debug.ss-low { background: rgba(29, 155, 240, 0.14); color: #1d9bf0; }
`;
  document.documentElement.appendChild(style);
}

export interface UiHandlers {
  onExpand: () => void;
  onMute: () => void;
  onBlock: () => void;
}

/**
 * State per rendered decision.
 *
 * A tweet article on X is `display:flex; flex-direction:row` (avatar column +
 * content column), so our card must never behave like a normal flex item:
 * - folded:   the card is the article's only visible child (block layout)
 * - advisory: the card takes a full width line of its own via flex-wrap, and
 *             the tweet stays readable underneath
 */
interface DecisionState {
  bar: HTMLDivElement;
  pill: HTMLSpanElement | null;
  toggle: HTMLButtonElement | null;
  mode: 'fold' | 'advisory';
  originalDisplay: string;
  originalFlexWrap: string;
  hidden: Array<{ el: HTMLElement; display: string }>;
  collapsed: boolean;
  pct: number;
  reason: string;
  t: (key: string) => string;
}

const states = new WeakMap<HTMLElement, DecisionState>();

function collapse(article: HTMLElement, state: DecisionState): void {
  if (state.collapsed) return;
  state.pill?.remove();
  state.pill = null;

  article.prepend(state.bar);
  const hidden: DecisionState['hidden'] = [];
  for (const child of Array.from(article.children)) {
    if (child === state.bar) continue;
    const el = child as HTMLElement;
    hidden.push({ el, display: el.style.display });
    el.style.display = 'none';
  }
  state.hidden = hidden;
  article.style.display = 'block';
  article.style.flexWrap = '';
  article.classList.add(FOLDED_CLASS);
  state.collapsed = true;
  if (state.toggle) state.toggle.textContent = state.t('expand');
}

function expand(article: HTMLElement, state: DecisionState): void {
  if (!state.collapsed) return;
  for (const { el, display } of state.hidden) el.style.display = display;
  state.hidden = [];
  article.style.display = state.originalDisplay;
  article.style.flexWrap = state.originalFlexWrap;
  article.classList.remove(FOLDED_CLASS);
  state.collapsed = false;

  if (state.mode === 'advisory') {
    // The card is the point of manual mode: keep it, just relabel the toggle.
    if (state.toggle) state.toggle.textContent = state.t('collapse');
    return;
  }

  // Folding card for auto modes: a block inside the flex row would squeeze the
  // body, so replace it with a pill and let a click fold the reply again.
  state.bar.remove();
  const pill = document.createElement('span');
  pill.className = 'anti-slop-badge anti-slop-pill';
  pill.textContent = `AI? ${state.pct}%`;
  pill.title = state.reason ? `${state.t('pillHint')} — ${state.reason}` : state.t('pillHint');
  pill.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    collapse(article, state);
  });
  const nameRow = article.querySelector('[data-testid="User-Name"]');
  (nameRow || article).appendChild(pill);
  state.pill = pill;
}

function restoreArticle(article: HTMLElement): void {
  const state = states.get(article);
  if (!state) return;
  for (const { el, display } of state.hidden) el.style.display = display;
  state.hidden = [];
  article.style.display = state.originalDisplay;
  article.style.flexWrap = state.originalFlexWrap;
  article.classList.remove(FOLDED_CLASS);
  state.pill?.remove();
  state.bar.remove();
  states.delete(article);
}

export type Presentation = 'fold' | 'advisory' | 'badge';

export function mountResult(
  article: HTMLElement,
  result: DecisionResult,
  presentation: Presentation,
  handlers: UiHandlers,
  t: (key: string) => string,
  postId?: string,
): void {
  ensureStyles();
  article.setAttribute(ROOT_ATTR, '1');
  if (postId) article.setAttribute(POST_ATTR, postId);
  restoreArticle(article);
  // Drop anything left by an earlier mount (e.g. after an extension reload).
  article
    .querySelectorAll('.anti-slop-bar, .anti-slop-badge, .anti-slop-debug')
    .forEach((n) => n.remove());
  article.classList.remove(FOLDED_CLASS);

  const pct = Math.round(result.score * 100);

  if (presentation === 'badge') {
    const badge = document.createElement('span');
    badge.className = 'anti-slop-badge ss-warn';
    badge.textContent = `AI? ${pct}%`;
    badge.title = result.reason;
    const nameRow = article.querySelector('[data-testid="User-Name"]');
    (nameRow || article).appendChild(badge);
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'anti-slop-bar';
  bar.style.width = '100%';
  bar.style.boxSizing = 'border-box';
  // The raw score breakdown stays one hover away instead of sitting in the UI.
  bar.title = result.reason;
  bar.innerHTML = `
    <span class="ss-score">${t('foldedLabel')} ${pct}%</span>
    <button type="button" data-act="toggle">${presentation === 'fold' ? t('expand') : t('collapse')}</button>
    <button type="button" data-act="mute" title="${escapeAttr(t('muteHint'))}">${t('mute')}</button>
    <button type="button" class="ss-danger" data-act="block" title="${escapeAttr(t('blockHint'))}">${t('block')}</button>
  `;
  const toggle = bar.querySelector('button[data-act="toggle"]') as HTMLButtonElement;

  const state: DecisionState = {
    bar,
    pill: null,
    toggle,
    mode: presentation === 'fold' ? 'fold' : 'advisory',
    originalDisplay: article.style.display,
    originalFlexWrap: article.style.flexWrap,
    hidden: [],
    collapsed: false,
    pct,
    reason: result.reason,
    t,
  };
  states.set(article, state);

  bar.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'toggle') {
      if (state.collapsed) expand(article, state);
      else collapse(article, state);
      handlers.onExpand();
    } else if (act === 'mute') handlers.onMute();
    else if (act === 'block') handlers.onBlock();
  });

  if (presentation === 'fold') {
    collapse(article, state);
    return;
  }

  // Advisory: let the card take a full line of its own, tweet body untouched.
  article.style.flexWrap = 'wrap';
  bar.style.flex = '0 0 100%';
  article.prepend(bar);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/\n/g, ' ');
}

/**
 * Debug mode: a read-only score on every post, whatever the normal mode would
 * have done with it. Never folds, so the page stays fully readable.
 */
export function mountDebugBadge(
  article: HTMLElement,
  result: DecisionResult,
  threshold: number,
  t: (key: string) => string,
  postId?: string,
): void {
  ensureStyles();
  restoreArticle(article);
  article.setAttribute(ROOT_ATTR, '1');
  if (postId) article.setAttribute(POST_ATTR, postId);
  article.querySelectorAll('.anti-slop-bar, .anti-slop-badge, .anti-slop-debug').forEach((n) =>
    n.remove(),
  );
  article.classList.remove(FOLDED_CLASS);

  const label = debugScoreLabel(result, threshold);
  const badge = document.createElement('span');
  badge.className = `anti-slop-debug ss-${label.level}`;
  badge.textContent = `AI ${label.pct}% · ${t(label.sourceKey)}`;
  badge.title = label.detail;
  badge.dataset.source = label.sourceKey;

  const nameRow = article.querySelector('[data-testid="User-Name"]');
  (nameRow || article).appendChild(badge);
}

/** `postId` makes a recycled article re-render for its new post. */
export function alreadyMounted(article: HTMLElement, postId?: string): boolean {
  if (!article.hasAttribute(ROOT_ATTR)) return false;
  if (postId == null) return true;
  return article.getAttribute(POST_ATTR) === postId;
}

export function clearMounted(article: HTMLElement): void {
  article.removeAttribute(ROOT_ATTR);
  article.removeAttribute(POST_ATTR);
  article.classList.remove(FOLDED_CLASS);
  restoreArticle(article);
  article
    .querySelectorAll('.anti-slop-bar, .anti-slop-badge, .anti-slop-debug')
    .forEach((n) => n.remove());
}
