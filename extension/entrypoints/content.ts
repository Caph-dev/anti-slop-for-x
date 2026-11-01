import { defineContentScript } from 'wxt/utils/define-content-script';
import { loadSettings, recognitionSettingsChanged, settingsKey } from '../lib/settings';
import {
  admission,
  createRecognizer,
  recognitionIdentity,
  requestFingerprint,
  sendRecognition,
} from '../lib/scorer';
import { createLimiter } from '../lib/concurrency';
import { createScanState, shouldScan, type ScanTicket } from '../lib/scan-state';
import {
  currentUserHandle,
  inScope,
  listArticles,
  postIdOf,
  readSnapshot,
  type PostSnapshot,
} from '../lib/x/dom';
import { blockUser, muteUser, unblockUser } from '../lib/x/mute-block';
import {
  alreadyMounted,
  announce,
  clearMounted,
  mountCard,
  mountDiagnostic,
  type CardView,
} from '../lib/ui';
import { decide, effectiveMode, userRule, type Decision, type Presentation } from '../lib/mode';
import { diagnosticLabel } from '../lib/debug';
import { createDiagnostics, outcomeCode } from '../lib/diagnostics';
import { createReaderProtection } from '../lib/reader-protection';
import { isTarget, recognitionContext, type Recognition } from '../lib/recognition';
import { uiT } from '../lib/i18n-ui';
import type { Settings } from '../lib/types';

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  runAt: 'document_idle',
  main() {
    void boot();
  },
});

/**
 * - `auto`: observers, needs auto-scan, only near the viewport.
 * - `manual`: the popup's "Scan current page"; sends even with auto-scan off.
 * - `refresh`: a settings change; re-renders from what is known, never sends.
 */
type Trigger = 'auto' | 'manual' | 'refresh';

/** What one article node shows (or, in shadow mode, recorded) and why. */
interface NodeRecord {
  renderKey: string;
  fingerprint: string;
  identity: string;
  postId: string;
  result: Recognition;
  /** True when the result came back from the background, not from local admission. */
  transported: boolean;
  /** Signature of what is mounted; '' when the post is untouched. */
  mounted: string;
}

/** Automatic requests pause this long after the provider answers 429. */
const RATE_LIMIT_PAUSE_MS = 60_000;

async function boot() {
  let settings = await loadSettings();
  const t = uiT();
  // One limiter for the whole session; changing the cap never splits the queue.
  const limiter = createLimiter(settings.maxConcurrency);
  /** Per-node dedupe and the generations that reject stale results (lib/scan-state.ts). */
  const scan = createScanState();
  /** Page-owned recognition cache, keyed by request identity. */
  const recognizer = createRecognizer();
  /** Per-tab, in-memory record for the popup. Nothing is persisted. */
  const diagnostics = createDiagnostics();
  const reading = createReaderProtection();
  let records = new WeakMap<HTMLElement, NodeRecord>();
  /** Identities the user reported as inaccurate in this tab. */
  const disputed = new Set<string>();
  /** Bumped by every settings change, so automatic scans re-evaluate every node once. */
  let settingsRevision = 0;
  let settingsLoadRevision = 0;
  let pausedUntil = 0;
  let pauseReason: 'rate_limited' | 'authentication' | null = null;

  chrome.storage.onChanged.addListener((changes, area) => {
    // Other local keys (action log, auto-guard state) change all the time;
    // only the settings key can change what is sent or shown.
    if (area !== 'local' || !changes[settingsKey()]) return;
    void resync();
  });
  await resync();

  function applySettings(next: Settings): void {
    const prev = settings;
    settings = next;
    settingsRevision++;
    if (next.maxConcurrency !== prev.maxConcurrency) limiter.setMax(next.maxConcurrency);

    if (!next.enabled) {
      scan.invalidate();
      unmountAll();
      return;
    }
    if (recognitionSettingsChanged(prev, next) || !prev.enabled) {
      // Results for another endpoint, model or key never apply to this one.
      scan.invalidate();
      recognizer.clear();
      pausedUntil = 0;
      pauseReason = null;
    } else if (shouldScan(prev, false) && !shouldScan(next, false)) {
      // Automatic work in flight must not land; manual scans keep going.
      scan.invalidateAutomatic();
      recognizer.invalidatePending();
    }
    // Mode, debug, scope, rules and no-send preferences only change admission
    // or presentation: re-render from known results without any request.
    refreshAll();
    if (shouldScan(next, false)) void scanVisible(false);
  }

  /** The background saw other settings than this page: catch up, but never loop. */
  async function resync(): Promise<void> {
    const revision = ++settingsLoadRevision;
    const fresh = await loadSettings();
    if (revision === settingsLoadRevision && JSON.stringify(fresh) !== JSON.stringify(settings)) applySettings(fresh);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ANTI_SLOP_UNBLOCK') {
      void unblockUser({ screenName: String(msg.handle), preferApi: true })
        .then((r) => sendResponse(r))
        .catch((e: unknown) => sendResponse({ ok: false, status: 0, method: 'error', detail: String(e) }));
      return true;
    }
    if (msg?.type === 'ANTI_SLOP_SCAN_NOW') {
      void scanVisible(true)
        .then((scanned) => sendResponse({ ok: true, scanned }))
        .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg?.type === 'ANTI_SLOP_DIAGNOSTICS') {
      sendResponse({
        ok: true,
        diagnostics: diagnostics.snapshot(),
        pause: pausedUntil > Date.now() ? pauseReason : null,
      });
      return false;
    }
    return false;
  });

  function renderKeyOf(snapshot: PostSnapshot): string {
    // Same id with other text or context (edits, a quote that finished
    // loading, a recycled node) is a different render.
    return JSON.stringify({ post: snapshot.post, input: snapshot.input });
  }

  function processedKey(renderKey: string): string {
    return `${settingsRevision}\n${renderKey}`;
  }

  function local(snapshot: PostSnapshot): Recognition | null {
    return admission({ isOwn: snapshot.post.isOwn, input: snapshot.input }, settings, userRule(snapshot.post, settings));
  }

  /** The node still shows exactly this snapshot, in scope. */
  function liveMatches(el: HTMLElement, renderKey: string): boolean {
    if (!el.isConnected) return false;
    const live = readSnapshot(el, currentUserHandle());
    return Boolean(live) && renderKeyOf(live!) === renderKey &&
      inScope(live!.post, settings.scanScope, location.pathname);
  }

  /** Right before transport: the request is still wanted under the current settings. */
  function sendable(el: HTMLElement, ticket: ScanTicket, renderKey: string, fingerprint: string, snapshot: PostSnapshot): boolean {
    if (!scan.owns(el, ticket) || !shouldScan(settings, ticket.force)) return false;
    if (!ticket.force && Date.now() < pausedUntil) return false;
    if (requestFingerprint(settings) !== fingerprint || local(snapshot)) return false;
    return liveMatches(el, renderKey);
  }

  /** Before a cache or log write: the answer still belongs to the current request. */
  function stillCurrent(el: HTMLElement, ticket: ScanTicket, renderKey: string, fingerprint: string, snapshot: PostSnapshot): boolean {
    return scan.owns(el, ticket) && shouldScan(settings, ticket.force) &&
      requestFingerprint(settings) === fingerprint && !local(snapshot) && liveMatches(el, renderKey);
  }

  /** Before mounting: this registration still owns the node and the node is unchanged. */
  function stillMountable(el: HTMLElement, ticket: ScanTicket, renderKey: string, fingerprint: string): boolean {
    return scan.owns(el, ticket) && shouldScan(settings, ticket.force) &&
      requestFingerprint(settings) === fingerprint && liveMatches(el, renderKey);
  }

  function notePause(result: Recognition): void {
    if (result.status !== 'failed') return;
    const manual = effectiveMode(settings.scanMode) === 'manual';
    if (result.error === 'rate_limited') {
      const wasPaused = Date.now() < pausedUntil;
      pausedUntil = Math.max(pausedUntil, Date.now() + RATE_LIMIT_PAUSE_MS);
      pauseReason = pauseReason === 'authentication' ? pauseReason : 'rate_limited';
      if (!wasPaused && manual) toast(t('rateLimitedPause'));
    } else if (result.error === 'authentication') {
      const wasPaused = pauseReason === 'authentication';
      pausedUntil = Number.POSITIVE_INFINITY;
      pauseReason = 'authentication';
      if (!wasPaused && manual) toast(t('authPause'));
    }
  }

  /** Returns true when the post reached a decision (shown or, in shadow, recorded). */
  async function processArticle(el: HTMLElement, trigger: Trigger): Promise<boolean> {
    const force = trigger !== 'auto';
    if (!shouldScan(settings, force)) return false;
    if (trigger === 'auto' && !isInViewport(el)) return false;

    const snapshot = readSnapshot(el, currentUserHandle());
    if (!snapshot || !inScope(snapshot.post, settings.scanScope, location.pathname)) {
      forget(el);
      return false;
    }
    if (isInViewport(el, 0)) reading.enter(snapshot.post.id, Date.now());

    const renderKey = renderKeyOf(snapshot);
    if (trigger === 'auto' && scan.isProcessed(el, processedKey(renderKey))) return false;
    const fingerprint = requestFingerprint(settings);
    const identity = recognitionIdentity(snapshot.input, fingerprint);

    let result: Recognition | undefined = local(snapshot) ?? undefined;
    let transported = false;
    if (!result) {
      const cached = recognizer.get(identity);
      const known = records.get(el);
      if (cached) {
        result = cached;
        transported = true;
      } else if (trigger === 'refresh' && known?.transported && known.renderKey === renderKey && known.fingerprint === fingerprint) {
        // A failure shown before a display change is shown again, not retried.
        result = known.result;
        transported = true;
      }
    }
    if (!result && trigger === 'refresh') {
      forget(el);
      return false;
    }
    if (!result && trigger === 'auto' && Date.now() < pausedUntil) return false;

    // Mounting a card is itself a DOM mutation, so a scan can run again before
    // the previous answer returns. Never submit the same render twice.
    const ticket = scan.begin(el, renderKey, force);
    if (!ticket) return false;
    try {
      if (!result) {
        const reply = await limiter.run(async () => {
          // The task may have waited in the queue while settings or the node changed.
          if (!sendable(el, ticket, renderKey, fingerprint, snapshot)) return null;
          return recognizer.run(identity, () => sendRecognition(snapshot.input, fingerprint, {
            handle: snapshot.post.handle,
            isOwn: snapshot.post.isOwn,
            replyScoped: inScope(snapshot.post, 'replies-only', location.pathname),
            automatic: !ticket.force,
          }));
        });
        if (!reply) return false;
        if (reply.ok && reply.transport) diagnostics.recordTransport(reply.transport);
        if (!reply.ok && reply.reason === 'stale') {
          void resync();
          return false;
        }
        // Settings changed mid-flight: this answer describes a request that is gone.
        if (!stillCurrent(el, ticket, renderKey, fingerprint, snapshot)) return false;
        result = reply.ok ? reply.result : { status: 'failed', error: 'internal', context: recognitionContext(snapshot.input) };
        transported = true;
        notePause(result);
        recognizer.store(identity, result);
      }
      // X recycles article nodes: never render post A's answer on post B.
      if (!stillMountable(el, ticket, renderKey, fingerprint)) return false;
      present(el, snapshot, { renderKey, fingerprint, identity, result, transported });
      scan.commit(el, processedKey(renderKey));
      return true;
    } finally {
      scan.end(el, ticket);
    }
  }

  function present(
    el: HTMLElement,
    snapshot: PostSnapshot,
    known: Pick<NodeRecord, 'renderKey' | 'fingerprint' | 'identity' | 'result' | 'transported'>,
  ): void {
    const { result, identity } = known;
    const postId = snapshot.post.id;
    const rule = userRule(snapshot.post, settings);
    const decision = decide(result, settings, rule, { disputed: disputed.has(`${postId}\n${identity}`) });
    let presentation: Presentation = decision.presentation;
    const now = Date.now();
    if (isInViewport(el, 0)) reading.enter(postId, now);
    const readerProtected = presentation === 'fold' && reading.protects(postId, now);
    if (readerProtected) presentation = 'advisory';

    diagnostics.record(postId, {
      status: result.status,
      code: outcomeCode(result),
      mode: effectiveMode(settings.scanMode),
      presentation,
      counterfactual: decision.counterfactual,
      decision: decision.reason,
      rule,
      context: result.context,
    });

    const signature = presentation === 'none' ? '' :
      `${known.renderKey}\n${known.fingerprint}\n${presentation}\n${decision.reason}\n${JSON.stringify(result)}\n${readerProtected}`;
    const previous = records.get(el);
    records.set(el, { ...known, postId, mounted: signature });
    if (presentation === 'none') {
      if (alreadyMounted(el)) clearMounted(el);
      return;
    }
    // Unchanged: keep whatever the user did with the card (folded or shown).
    if (previous?.mounted === signature && alreadyMounted(el, postId)) return;
    if (presentation === 'diagnostic') {
      mountDiagnostic(el, diagnosticLabel(result, t), t, postId);
      return;
    }
    mountCard(el, cardView(snapshot, result, decision, presentation, readerProtected), handlersFor(el, snapshot, identity, result), t, postId);
  }

  function cardView(
    snapshot: PostSnapshot,
    result: Recognition,
    decision: Decision,
    presentation: 'advisory' | 'fold',
    readerProtected: boolean,
  ): CardView {
    if (decision.reason === 'user_hide') {
      return {
        presentation,
        kind: 'rule',
        title: readerProtected ? t('ruleHiddenVisible') : t('ruleHidden'),
        evidence: [],
        counterevidence: [],
        handle: snapshot.post.handle,
      };
    }
    const target = isTarget(result) ? result : null;
    return {
      presentation: 'advisory',
      kind: 'model',
      title: target ? t(`cat_${target.category}`) : '',
      category: target?.category,
      evidence: target?.evidence ?? [],
      counterevidence: target?.counterevidence ?? [],
      rationale: target?.reason,
      handle: snapshot.post.handle,
    };
  }

  function handlersFor(el: HTMLElement, snapshot: PostSnapshot, identity: string, result: Recognition) {
    const { id: postId, handle } = snapshot.post;
    return {
      // Shown once by the user: a later re-render must not fold it again.
      onToggle: (collapsed: boolean) => {
        if (!collapsed) reading.markSeen(postId);
      },
      // Report: local and per tab. No rule changes, nothing sent.
      onReport: () => {
        if (!isTarget(result)) return;
        disputed.add(`${postId}\n${identity}`);
        diagnostics.report(result.category);
        const record = records.get(el);
        if (record && record.identity === identity && liveMatches(el, record.renderKey)) present(el, snapshot, record);
        toast(t('reported'));
      },
      // Permanent keep: the background adds the account to the keep list;
      // the settings change then re-renders every post by that account.
      onKeep: () => {
        void chrome.runtime.sendMessage({ type: 'ANTI_SLOP_KEEP_ACCOUNT', handle })
          .then((reply: { ok?: boolean } | undefined) => {
            if (reply?.ok) toast(`${t('kept')}: @${handle}`);
            else announce(el, t('keepFail'));
          })
          .catch(() => announce(el, t('keepFail')));
      },
      onMute: () => {
        void muteUser({ article: el, screenName: handle, userId: null }).then((r) => {
          toast(r.ok ? t('muteOk') : `${t('actionFail')}: ${r.detail || r.method}`);
        });
      },
      onBlock: () => {
        void blockUser({ article: el, screenName: handle, userId: null }).then((r) => {
          toast(r.ok ? t('blockOk') : `${t('actionFail')}: ${r.detail || r.method}`);
        });
      },
    };
  }

  /** Drop what this node showed: it holds another post now, or none in scope. */
  function forget(el: HTMLElement): void {
    records.delete(el);
    scan.forget(el);
    if (alreadyMounted(el)) clearMounted(el);
  }

  function unmountAll(): void {
    document.querySelectorAll<HTMLElement>('[data-anti-slop]').forEach((el) => clearMounted(el));
    records = new WeakMap();
  }

  /** Re-render every post from known results after a settings change. Sends nothing. */
  function refreshAll(): void {
    for (const el of listArticles()) void processArticle(el, 'refresh');
  }

  /** Returns how many posts reached a decision, so the popup can report it. */
  async function scanVisible(force = false): Promise<number> {
    if (!shouldScan(settings, force)) return 0;
    const results = await Promise.all(listArticles().map((el) => processArticle(el, force ? 'manual' : 'auto')));
    return results.filter(Boolean).length;
  }

  const mo = new MutationObserver(() => {
    for (const el of listArticles()) {
      const record = records.get(el);
      if (record?.mounted && !alreadyMounted(el, record.postId)) scan.forget(el);
    }
    if (shouldScan(settings, false)) void scanVisible(false);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Viewport trigger for automatic scans.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.target instanceof HTMLElement) {
          void processArticle(e.target, 'auto');
        }
      }
    },
    { root: null, rootMargin: '100px', threshold: 0.05 },
  );

  // Reading bookkeeping for reader protection (no margin: actually on screen).
  const visibility = new IntersectionObserver(
    (entries) => {
      const now = Date.now();
      for (const e of entries) {
        const id = postIdOf(e.target);
        if (!id) continue;
        if (e.isIntersecting) reading.enter(id, now);
        else reading.leave(id, now);
      }
    },
    { root: null, rootMargin: '0px', threshold: 0.2 },
  );

  const observed = new Set<HTMLElement>();
  const watch = () => {
    for (const el of observed) {
      if (el.isConnected) continue;
      io.unobserve(el);
      visibility.unobserve(el);
      observed.delete(el);
    }
    for (const el of listArticles()) {
      if (observed.has(el)) continue;
      io.observe(el);
      visibility.observe(el);
      observed.add(el);
    }
  };
  watch();
  setInterval(watch, 2000);

  if (shouldScan(settings, false)) void scanVisible(false);

  // Manual scan hook for the extension console; same gates as the popup.
  (globalThis as unknown as { __antiSlopScan?: () => void }).__antiSlopScan = () => {
    void scanVisible(true);
  };
}

function isInViewport(el: Element, margin = 120): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < (window.innerHeight || 800) + margin;
}

function toast(msg: string) {
  const n = document.createElement('div');
  n.textContent = msg;
  n.setAttribute('role', 'status');
  Object.assign(n.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '999999',
    padding: '10px 14px',
    borderRadius: '10px',
    background: 'rgba(0,0,0,0.8)',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'system-ui,sans-serif',
  });
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 2200);
}
