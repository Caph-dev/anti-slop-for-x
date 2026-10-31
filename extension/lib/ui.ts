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
.anti-slop-bar .ss-reason { opacity: 0.7; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
`;
  document.documentElement.appendChild(style);
}

export interface UiHandlers {
  onExpand: () => void;
  onMute: () => void;
  onBlock: () => void;
}

/**
 * Fold state per tweet, so Expand / unmount can restore the exact inline styles
 * we overwrote. A tweet article on X is `display:flex; flex-direction:row`
 * (avatar column + content column), so inserting a block into it lays out
 * sideways and squeezes the content; we override the article and hide its
 * children directly instead of relying on a class React may rewrite.
 */
interface FoldState {
  bar: HTMLDivElement;
  articleDisplay: string;
  hidden: Array<{ el: HTMLElement; display: string }>;
}

const folds = new WeakMap<HTMLElement, FoldState>();

function collapseArticle(article: HTMLElement, bar: HTMLDivElement): void {
  const hidden: FoldState['hidden'] = [];
  for (const child of Array.from(article.children)) {
    if (child === bar) continue;
    const el = child as HTMLElement;
    hidden.push({ el, display: el.style.display });
    el.style.display = 'none';
  }
  const articleDisplay = article.style.display;
  article.style.display = 'block';
  folds.set(article, { bar, articleDisplay, hidden });
}

function restoreArticle(article: HTMLElement): void {
  const state = folds.get(article);
  if (!state) return;
  for (const { el, display } of state.hidden) el.style.display = display;
  article.style.display = state.articleDisplay;
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
    article.classList.add(FOLDED_CLASS);
    const bar = document.createElement('div');
    bar.className = 'anti-slop-bar';
    bar.style.width = '100%';
    bar.style.boxSizing = 'border-box';
    bar.innerHTML = `
      <span class="ss-score">${t('foldedLabel')} ${pct}%</span>
      <span class="ss-reason" title="${escapeAttr(result.reason)}">${escapeHtml(result.reason)}</span>
      <button type="button" data-act="expand">${t('expand')}</button>
      <button type="button" data-act="mute">${t('mute')}</button>
      <button type="button" class="ss-danger" data-act="block">${t('block')}</button>
    `;
    bar.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'expand') {
        article.classList.remove(FOLDED_CLASS);
        restoreArticle(article);
        handlers.onExpand();
      } else if (act === 'mute') handlers.onMute();
      else if (act === 'block') handlers.onBlock();
    });
    article.prepend(bar);
    collapseArticle(article, bar);
  } else if (result.score >= threshold * 0.7 && result.source !== 'skipped') {
    // Soft badge only: the muted action bar used to be appended to the article,
    // where the flex row pushed it to the right edge on top of the action row.
    // Mute / Block stay available from the fold card and X's own menu.
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
