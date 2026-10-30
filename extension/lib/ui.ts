/** Fold / badge / Mute-Block UI injected into X tweets */

import type { DecisionResult } from './types';

const ROOT_ATTR = 'data-slop-shield';
const FOLDED_CLASS = 'slop-shield-folded';
const STYLE_ID = 'slop-shield-styles';

export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.${FOLDED_CLASS} > *:not(.slop-shield-bar) { display: none !important; }
.slop-shield-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 10px 12px; margin: 4px 0; border-radius: 12px;
  background: rgba(120,120,120,0.12); font-size: 13px; line-height: 1.3;
  color: inherit; font-family: system-ui, -apple-system, sans-serif;
}
.slop-shield-bar .ss-score { font-weight: 600; opacity: 0.9; }
.slop-shield-bar .ss-reason { opacity: 0.7; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slop-shield-bar button {
  border: 1px solid rgba(127,127,127,0.4); background: transparent; color: inherit;
  border-radius: 999px; padding: 4px 10px; cursor: pointer; font-size: 12px;
}
.slop-shield-bar button:hover { background: rgba(127,127,127,0.15); }
.slop-shield-bar button.ss-danger:hover { border-color: #f4212e; color: #f4212e; }
.slop-shield-badge {
  display: inline-flex; align-items: center; gap: 4px;
  margin-left: 8px; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  background: rgba(244, 33, 46, 0.12); color: #f4212e;
}
.slop-shield-badge.ss-warn { background: rgba(255, 173, 31, 0.18); color: #cc8b00; }
`;
  document.documentElement.appendChild(style);
}

export interface UiHandlers {
  onExpand: () => void;
  onMute: () => void;
  onBlock: () => void;
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

  // Remove previous bar
  article.querySelectorAll('.slop-shield-bar').forEach((n) => n.remove());
  article.querySelectorAll('.slop-shield-badge').forEach((n) => n.remove());
  article.classList.remove(FOLDED_CLASS);

  const pct = Math.round(result.score * 100);
  const fold = result.score >= threshold && result.source !== 'skipped';

  if (fold) {
    article.classList.add(FOLDED_CLASS);
    const bar = document.createElement('div');
    bar.className = 'slop-shield-bar';
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
        handlers.onExpand();
      } else if (act === 'mute') handlers.onMute();
      else if (act === 'block') handlers.onBlock();
    });
    article.prepend(bar);
  } else if (result.score >= threshold * 0.7 && result.source !== 'skipped') {
    // Soft badge without fold
    const badge = document.createElement('span');
    badge.className = 'slop-shield-badge ss-warn';
    badge.textContent = `AI? ${pct}%`;
    badge.title = result.reason;
    const nameRow = article.querySelector('[data-testid="User-Name"]');
    (nameRow || article).appendChild(badge);

    // Still offer mute/block via small bar? Keep minimal: only when folded for v1 mute/block prominence
    // Add tiny action buttons next to badge for borderline
    const actions = document.createElement('div');
    actions.className = 'slop-shield-bar';
    actions.style.padding = '4px 8px';
    actions.innerHTML = `
      <button type="button" data-act="mute">${t('mute')}</button>
      <button type="button" class="ss-danger" data-act="block">${t('block')}</button>
    `;
    actions.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'mute') handlers.onMute();
      else if (act === 'block') handlers.onBlock();
    });
    article.appendChild(actions);
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
  article.querySelectorAll('.slop-shield-bar, .slop-shield-badge').forEach((n) => n.remove());
}
