/** Fold / badge / Mute-Block UI injected into X tweets */

import type { DecisionResult } from './types';

const ROOT_ATTR = 'data-anti-slop';
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
`;
  document.documentElement.appendChild(style);
}

export interface UiHandlers {
  onExpand: () => void;
  onMute: () => void;
  onBlock: () => void;
}

/**
 * State per folded tweet. A tweet article on X is `display:flex;
 * flex-direction:row` (avatar column + content column), so while folded the
 * card sits in the article with its siblings hidden; while expanded the card is
 * removed and replaced by a small pill in the name row, because leaving a block
 * inside that flex row would squeeze the tweet body again.
 */
interface FoldState {
  bar: HTMLDivElement;
  pill: HTMLSpanElement | null;
  originalDisplay: string;
  hidden: Array<{ el: HTMLElement; display: string }>;
  collapsed: boolean;
  pct: number;
  reason: string;
  t: (key: string) => string;
}

const folds = new WeakMap<HTMLElement, FoldState>();

function collapse(article: HTMLElement, state: FoldState): void {
  if (state.collapsed) return;
  state.pill?.remove();
  state.pill = null;

  article.prepend(state.bar);
  const hidden: FoldState['hidden'] = [];
  for (const child of Array.from(article.children)) {
    if (child === state.bar) continue;
    const el = child as HTMLElement;
    hidden.push({ el, display: el.style.display });
    el.style.display = 'none';
  }
  state.hidden = hidden;
  article.style.display = 'block';
  article.classList.add(FOLDED_CLASS);
  state.collapsed = true;
}

function expand(article: HTMLElement, state: FoldState): void {
  if (!state.collapsed) return;
  for (const { el, display } of state.hidden) el.style.display = display;
  state.hidden = [];
  article.style.display = state.originalDisplay;
  article.classList.remove(FOLDED_CLASS);
  state.collapsed = false;

  // Keep the score reachable without leaving a block in the flex row.
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
  const state = folds.get(article);
  if (!state) return;
  for (const { el, display } of state.hidden) el.style.display = display;
  state.hidden = [];
  article.style.display = state.originalDisplay;
  article.classList.remove(FOLDED_CLASS);
  state.pill?.remove();
  state.bar.remove();
  folds.delete(article);
}

export function mountResult(
  article: HTMLElement,
  result: DecisionResult,
  threshold: number,
  handlers: UiHandlers,
  t: (key: string) => string,
): void {
  ensureStyles();
  article.setAttribute(ROOT_ATTR, '1');
  restoreArticle(article);
  // Drop anything left by an earlier mount (e.g. after an extension reload).
  article.querySelectorAll('.anti-slop-bar, .anti-slop-badge').forEach((n) => n.remove());
  article.classList.remove(FOLDED_CLASS);

  const pct = Math.round(result.score * 100);
  const fold = result.score >= threshold && result.source !== 'skipped';

  if (fold) {
    const bar = document.createElement('div');
    bar.className = 'anti-slop-bar';
    bar.style.width = '100%';
    bar.style.boxSizing = 'border-box';
    // The raw score breakdown stays one hover away instead of sitting in the UI.
    bar.title = result.reason;
    bar.innerHTML = `
      <span class="ss-score">${t('foldedLabel')} ${pct}%</span>
      <button type="button" data-act="expand">${t('expand')}</button>
      <button type="button" data-act="mute" title="${escapeAttr(t('muteHint'))}">${t('mute')}</button>
      <button type="button" class="ss-danger" data-act="block" title="${escapeAttr(t('blockHint'))}">${t('block')}</button>
    `;

    const state: FoldState = {
      bar,
      pill: null,
      originalDisplay: article.style.display,
      hidden: [],
      collapsed: false,
      pct,
      reason: result.reason,
      t,
    };
    folds.set(article, state);

    bar.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'expand') {
        expand(article, state);
        handlers.onExpand();
      } else if (act === 'mute') handlers.onMute();
      else if (act === 'block') handlers.onBlock();
    });

    collapse(article, state);
  } else if (result.score >= threshold * 0.7 && result.source !== 'skipped') {
    // Passive indicator: mute/block stay available from the fold card and X's
    // own menu, so no extra action bar is injected next to the badge.
    const badge = document.createElement('span');
    badge.className = 'anti-slop-badge ss-warn';
    badge.textContent = `AI? ${pct}%`;
    badge.title = result.reason;
    const nameRow = article.querySelector('[data-testid="User-Name"]');
    (nameRow || article).appendChild(badge);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/\n/g, ' ');
}

export function alreadyMounted(article: HTMLElement): boolean {
  return article.hasAttribute(ROOT_ATTR);
}

export function clearMounted(article: HTMLElement): void {
  article.removeAttribute(ROOT_ATTR);
  article.classList.remove(FOLDED_CLASS);
  restoreArticle(article);
  article.querySelectorAll('.anti-slop-bar, .anti-slop-badge').forEach((n) => n.remove());
}
