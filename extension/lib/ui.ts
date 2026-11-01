/**
 * Marks, folds and debug badges injected into X posts.
 *
 * Every piece of untrusted text (post quotes, the model's explanation, handles)
 * is written with `textContent`, never parsed as HTML. Folding hides the
 * article's own children and is always reversible from the card.
 */
import type { DiagnosticLabel } from './debug';
import type { Category, Evidence } from './recognition';

const ROOT_ATTR = 'data-anti-slop';
/** Post id the card was rendered for; X reuses article nodes across posts. */
const POST_ATTR = 'data-anti-slop-post';
const FOLDED_CLASS = 'anti-slop-folded';
const STYLE_ID = 'anti-slop-styles';
const INJECTED = '.anti-slop-bar, .anti-slop-badge, .anti-slop-debug';

export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.${FOLDED_CLASS} > *:not(.anti-slop-bar) { display: none !important; }
.anti-slop-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 10px 12px; margin: 4px 0; border-radius: 8px;
  background: rgba(120,120,120,0.12); font-size: 13px; line-height: 1.3;
  color: inherit; font-family: system-ui, -apple-system, sans-serif;
}
.anti-slop-bar .ss-label { font-weight: 600; opacity: 0.9; }
.anti-slop-bar button {
  border: 1px solid rgba(127,127,127,0.4); background: transparent; color: inherit;
  border-radius: 999px; padding: 4px 10px; cursor: pointer; font-size: 12px;
}
.anti-slop-bar button:hover { background: rgba(127,127,127,0.15); }
.anti-slop-bar button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; }
.anti-slop-bar button.ss-danger:hover { border-color: #f4212e; color: #f4212e; }
.anti-slop-bar .ss-why { flex: 0 0 100%; font-size: 12px; }
.anti-slop-bar .ss-why summary { cursor: pointer; opacity: 0.8; }
.anti-slop-bar .ss-why p { margin: 6px 0 2px; }
.anti-slop-bar .ss-why ul { margin: 2px 0; padding-left: 18px; }
.anti-slop-bar .ss-src { font-weight: 600; margin-right: 4px; }
.anti-slop-bar .ss-live:empty { display: none; }
.anti-slop-bar .ss-live { flex: 0 0 100%; font-size: 12px; opacity: 0.8; }
.anti-slop-debug {
  display: inline-flex; align-items: center; gap: 4px;
  margin-left: 8px; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  background: rgba(127,127,127,0.16); color: inherit;
}
.anti-slop-debug.ss-target { background: rgba(244, 33, 46, 0.16); color: #f4212e; }
.anti-slop-debug.ss-problem { background: rgba(255, 173, 31, 0.2); color: #cc8b00; }
.anti-slop-debug.ss-normal { background: rgba(29, 155, 240, 0.14); color: #1d9bf0; }
`;
  document.documentElement.appendChild(style);
}

export interface CardView {
  /** `fold` starts collapsed and is only used for the user's hide rule. */
  presentation: 'advisory' | 'fold';
  kind: 'model' | 'rule';
  /** Trusted label text (category or rule). */
  title: string;
  category?: Category;
  evidence: Evidence[];
  counterevidence: Evidence[];
  /** The model's own explanation: untrusted, shown as plain text only. */
  rationale?: string;
  /** Untrusted, from the page. */
  handle: string;
}

export interface CardHandlers {
  /** Called after the user folds or shows the post from the card. */
  onToggle?: (collapsed: boolean) => void;
  onReport?: () => void;
  onKeep?: () => void;
  onMute?: () => void;
  onBlock?: () => void;
}

/**
 * A tweet article on X is `display:flex; flex-direction:row` (avatar column +
 * content column), so the card must never behave like a normal flex item:
 * folded, it is the article's only visible child; open, it takes a full-width
 * line of its own via flex-wrap and the post stays readable underneath.
 */
interface CardState {
  bar: HTMLDivElement;
  toggle: HTMLButtonElement;
  live: HTMLSpanElement;
  kind: CardView['kind'];
  originalDisplay: string;
  originalFlexWrap: string;
  hidden: Array<{ el: HTMLElement; display: string }>;
  collapsed: boolean;
  t: (key: string) => string;
}

const states = new WeakMap<HTMLElement, CardState>();

function toggleLabel(state: CardState): string {
  if (state.kind === 'rule') return state.collapsed ? state.t('showOnce') : state.t('foldAgain');
  return state.collapsed ? state.t('show') : state.t('fold');
}

function syncToggle(state: CardState): void {
  state.toggle.textContent = toggleLabel(state);
  state.toggle.setAttribute('aria-expanded', String(!state.collapsed));
  state.toggle.title = !state.collapsed ? state.t('foldHint') : state.kind === 'rule' ? state.t('showOnceHint') : '';
}

function collapse(article: HTMLElement, state: CardState): void {
  if (state.collapsed) return;
  article.prepend(state.bar);
  const hidden: CardState['hidden'] = [];
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
  syncToggle(state);
}

function openLayout(article: HTMLElement, state: CardState): void {
  article.style.flexWrap = 'wrap';
  state.bar.style.flex = '0 0 100%';
  if (state.bar.parentElement !== article) article.prepend(state.bar);
}

function expand(article: HTMLElement, state: CardState): void {
  if (!state.collapsed) return;
  for (const { el, display } of state.hidden) el.style.display = display;
  state.hidden = [];
  article.style.display = state.originalDisplay;
  article.classList.remove(FOLDED_CLASS);
  state.collapsed = false;
  openLayout(article, state);
  syncToggle(state);
}

function restoreArticle(article: HTMLElement): void {
  const state = states.get(article);
  if (!state) return;
  for (const { el, display } of state.hidden) el.style.display = display;
  state.hidden = [];
  article.style.display = state.originalDisplay;
  article.style.flexWrap = state.originalFlexWrap;
  article.classList.remove(FOLDED_CLASS);
  state.bar.remove();
  states.delete(article);
}

function button(act: string, label: string, hint: string, danger = false): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.dataset.act = act;
  el.textContent = label;
  el.title = hint;
  if (danger) el.className = 'ss-danger';
  return el;
}

function quoteList(items: Evidence[], t: (key: string) => string): HTMLElement {
  if (!items.length) {
    const none = document.createElement('p');
    none.textContent = t('noneCited');
    return none;
  }
  const list = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    const source = document.createElement('span');
    source.className = 'ss-src';
    source.textContent = t(`src_${item.source}`);
    const quote = document.createElement('q');
    quote.textContent = item.quote;
    li.append(source, quote);
    list.append(li);
  }
  return list;
}

function whyBlock(view: CardView, t: (key: string) => string): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'ss-why';
  const summary = document.createElement('summary');
  summary.textContent = t('why');
  const note = document.createElement('p');
  note.textContent = t('modelNote');
  const evidenceTitle = document.createElement('p');
  evidenceTitle.textContent = t('evidence');
  const counterTitle = document.createElement('p');
  counterTitle.textContent = t('counterevidence');
  details.append(summary, note, evidenceTitle, quoteList(view.evidence, t), counterTitle, quoteList(view.counterevidence, t));
  if (view.rationale) {
    const rationaleTitle = document.createElement('p');
    rationaleTitle.textContent = t('rationale');
    const rationale = document.createElement('p');
    rationale.className = 'ss-rationale';
    rationale.textContent = view.rationale;
    details.append(rationaleTitle, rationale);
  }
  return details;
}

function prepare(article: HTMLElement, postId?: string): void {
  ensureStyles();
  restoreArticle(article);
  article.querySelectorAll(INJECTED).forEach((n) => n.remove());
  article.classList.remove(FOLDED_CLASS);
  article.setAttribute(ROOT_ATTR, '1');
  if (postId) article.setAttribute(POST_ATTR, postId);
  else article.removeAttribute(POST_ATTR);
}

/**
 * A mark (`advisory`, post stays open) or a fold (`fold`, collapsed; only for
 * the user's hide rule). Fold / Show, "Not accurate", "Always keep" and
 * Mute / Block are separate buttons with separate effects.
 */
export function mountCard(
  article: HTMLElement,
  view: CardView,
  handlers: CardHandlers,
  t: (key: string) => string,
  postId?: string,
): void {
  if (view.presentation === 'fold' && view.kind !== 'rule') {
    throw new Error('Only a user hide rule may fold a post');
  }
  prepare(article, postId);

  const bar = document.createElement('div');
  bar.className = 'anti-slop-bar';
  bar.style.width = '100%';
  bar.style.boxSizing = 'border-box';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', `${t('cardLabel')}: ${view.title}`);
  bar.dataset.kind = view.kind;
  if (view.category) bar.dataset.category = view.category;

  const label = document.createElement('span');
  label.className = 'ss-label';
  label.textContent = view.title;
  bar.append(label);

  const toggle = button('toggle', '', '');
  bar.append(toggle);
  if (view.kind === 'model') bar.append(button('report', t('report'), t('reportHint')));
  const keep = button('keep', t('keep'), t('keepHint'));
  keep.setAttribute('aria-label', `${t('keep')} @${view.handle}`);
  bar.append(keep);
  bar.append(button('mute', t('mute'), t('muteHint')));
  bar.append(button('block', t('block'), t('blockHint'), true));
  if (view.kind === 'model') bar.append(whyBlock(view, t));
  const live = document.createElement('span');
  live.className = 'ss-live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  bar.append(live);

  const state: CardState = {
    bar,
    toggle,
    live,
    kind: view.kind,
    originalDisplay: article.style.display,
    originalFlexWrap: article.style.flexWrap,
    hidden: [],
    collapsed: false,
    t,
  };
  states.set(article, state);

  bar.addEventListener('click', (ev) => {
    const target = ev.target as Element | null;
    const btn = target?.closest?.('button[data-act]') as HTMLButtonElement | null;
    if (!btn || !bar.contains(btn)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'toggle') {
      if (state.collapsed) expand(article, state);
      else collapse(article, state);
      handlers.onToggle?.(state.collapsed);
    } else if (act === 'report') handlers.onReport?.();
    else if (act === 'keep') handlers.onKeep?.();
    else if (act === 'mute') handlers.onMute?.();
    else if (act === 'block') handlers.onBlock?.();
  });

  if (view.presentation === 'fold') {
    collapse(article, state);
    return;
  }
  syncToggle(state);
  openLayout(article, state);
}

/** Polite status line inside the post's card, for action feedback. */
export function announce(article: HTMLElement, message: string): void {
  const state = states.get(article);
  if (state) state.live.textContent = message;
}

/** True when the card for this article is collapsed. */
export function isCollapsed(article: HTMLElement): boolean {
  return states.get(article)?.collapsed ?? false;
}

/** Debug: the recognition state of a post as a small badge. Never folds. */
export function mountDiagnostic(
  article: HTMLElement,
  label: DiagnosticLabel,
  t: (key: string) => string,
  postId?: string,
): void {
  prepare(article, postId);
  const badge = document.createElement('span');
  badge.className = `anti-slop-debug ss-${label.level}`;
  badge.textContent = label.text;
  badge.title = `${t('debugHint')}\n${label.detail}`;
  badge.dataset.status = label.status;
  const nameRow = article.querySelector('[data-testid="User-Name"]');
  (nameRow || article).appendChild(badge);
}

/** `postId` makes a recycled article re-render for its new post. */
export function alreadyMounted(article: HTMLElement, postId?: string): boolean {
  const state = states.get(article);
  const badge = article.querySelector('.anti-slop-debug');
  const present = state ? article.contains(state.bar) : Boolean(badge);
  if (!article.hasAttribute(ROOT_ATTR) || !present) {
    if (state || badge || article.hasAttribute(ROOT_ATTR) || article.classList.contains(FOLDED_CLASS)) clearMounted(article);
    return false;
  }
  if (postId == null) return true;
  return article.getAttribute(POST_ATTR) === postId;
}

export function clearMounted(article: HTMLElement): void {
  article.removeAttribute(ROOT_ATTR);
  article.removeAttribute(POST_ATTR);
  article.classList.remove(FOLDED_CLASS);
  restoreArticle(article);
  article.querySelectorAll(INJECTED).forEach((n) => n.remove());
}
