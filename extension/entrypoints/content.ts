import { defineContentScript } from 'wxt/utils/define-content-script';
import { loadSettings, scoringSettingsChanged, settingsKey } from '../lib/settings';
import { scorePost } from '../lib/scorer';
import { createLimiter } from '../lib/concurrency';
import { createScanState } from '../lib/scan-state';
import {
  currentUserHandle,
  extractTweet,
  listTweets,
  parentCreatedAtMs,
  parentTextFor,
} from '../lib/x/dom';
import { blockUser, muteUser, unblockUser } from '../lib/x/mute-block';
import { alreadyMounted, clearMounted, mountDebugBadge, mountResult } from '../lib/ui';
import { debugCacheKey, debugScoringSettings } from '../lib/debug';
import { clearCache } from '../lib/cache';
import { decide } from '../lib/mode';
import { logAutoAction, type AutoActionEntry } from '../lib/action-log';
import {
  MELTDOWN_MS,
  isHandled,
  markHandled,
  pauseAutoActions,
  reserveAutoAction,
} from '../lib/auto-guard';
import { uiT } from '../lib/i18n-ui';
import type { DecisionResult, PostExtract, Settings } from '../lib/types';

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  runAt: 'document_idle',
  main() {
    void boot();
  },
});

async function boot() {
  let settings = await loadSettings();
  const t = uiT();
  // One limiter for the whole session; changing the cap never splits the queue.
  const limiter = createLimiter(settings.maxConcurrency);
  /**
   * Per-node dedupe plus the generation that rejects scores computed under
   * settings the user has since changed (see lib/scan-state.ts).
   */
  const scan = createScanState();
  /** Debug badges only: lets a threshold change recolour without re-scoring. */
  const debugScores = new WeakMap<HTMLElement, { postId: string; result: DecisionResult }>();

  chrome.storage.onChanged.addListener((changes, area) => {
    // Other local keys (the action log, auto-guard state) change all the time;
    // reacting to them would throw away scores for an unchanged policy.
    if (area !== 'local' || !changes[settingsKey()]) return;
    void loadSettings().then((s) => {
      const prev = settings;
      const debugToggled = s.debugMode !== prev.debugMode;
      const scoringChanged = scoringSettingsChanged(prev, s);
      const enabledChanged = s.enabled !== prev.enabled;
      const thresholdChanged = s.threshold !== prev.threshold;

      settings = s;
      if (s.maxConcurrency !== prev.maxConcurrency) limiter.setMax(s.maxConcurrency);

      // Invalidate first, unconditionally: a single save can change the model
      // *and* flip debug mode, and both caches must react to it.
      if (scoringChanged) clearCache();
      if (debugToggled) clearCache('debug:');
      if (scoringChanged || debugToggled || enabledChanged) scan.invalidate();

      if (!s.enabled) {
        unmountAll();
        return;
      }

      if (scoringChanged || debugToggled || enabledChanged) {
        // Every mounted card was decided under the old policy. Re-present the
        // page when we are allowed to scan; with auto-scan off, a manual scan
        // re-scores it (the cache was dropped, so nothing stale comes back).
        if (s.debugMode || s.autoScan) {
          unmountAll();
          void scanVisible(s.debugMode);
        } else if (debugToggled) {
          unmountAll();
        }
        return;
      }

      // Display-only edit: the debug bands are relative to the threshold, so
      // recolour the badges from the scores we already have instead of paying
      // for another model call.
      if (s.debugMode && thresholdChanged) {
        for (const el of document.querySelectorAll<HTMLElement>('[data-anti-slop]')) {
          const scored = debugScores.get(el);
          // The same identity check the async path makes: X recycles nodes.
          if (!scored || !el.isConnected) continue;
          if (extractTweet(el)?.id !== scored.postId) continue;
          mountDebugBadge(el, scored.result, s.threshold, t, scored.postId);
        }
      }
    });
  });

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
    return false;
  });

  async function toExtract(el: HTMLElement): Promise<PostExtract | null> {
    const tweet = extractTweet(el);
    if (!tweet) return null;
    const me = currentUserHandle();
    // Debug scores everything; the replies-only scope only saves model calls.
    if (settings.scanScope === 'replies-only' && !tweet.isReply && !settings.debugMode) {
      // On a status page, still score replies; skip original / timeline roots
      const statusId = location.pathname.match(/\/status\/(\d+)/)?.[1];
      if (!statusId || tweet.id === statusId) return null;
    }
    return {
      id: tweet.id,
      handle: tweet.handle,
      text: tweet.text,
      isReply: tweet.isReply,
      parentText: parentTextFor(el, tweet),
      createdAtMs: tweet.createdAtMs,
      parentCreatedAtMs: parentCreatedAtMs(el, tweet),
      userId: tweet.userId,
      isOwn: me != null && me.toLowerCase() === tweet.handle.toLowerCase(),
    };
  }

  /** Returns true when the post was actually scored and rendered. */
  async function handleArticle(el: HTMLElement, force = false): Promise<boolean> {
    if (!settings.enabled) return false;
    // Debug is a full-page read: score every mounted post, not just the
    // scrolled-past slice the normal viewport scheduling covers.
    if (!force && !settings.debugMode && !isInViewport(el)) return false;

    const post = await toExtract(el);
    if (!post) return false;
    if (!force && (scan.isProcessed(el, post.id) || alreadyMounted(el, post.id))) return false;
    // Mounting a badge is itself a DOM mutation, so a scan can run again before
    // the previous score returns. Never submit the same post twice.
    const ticket = scan.begin(el, post.id);
    if (!ticket) return false;

    const debug = settings.debugMode;
    const scoringSettings = debug ? debugScoringSettings(settings) : settings;
    const options = {
      shouldCache: () => scan.isCurrent(ticket),
      ...(debug ? { cacheKey: debugCacheKey(post.id) } : {}),
    };

    let result: DecisionResult | null;
    try {
      result = await limiter.run(async () => {
        // The task may have waited in the queue while the settings changed,
        // or the extension was switched off.
        if (!settings.enabled || !scan.isCurrent(ticket)) return null;
        return scorePost(post, scoringSettings, options);
      });
    } finally {
      scan.end(el, ticket);
    }

    // Settings changed mid-flight: this score describes a policy that is gone.
    if (!result || !scan.isCurrent(ticket) || !settings.enabled) return false;
    // X recycles article nodes; never render post A's score on post B.
    if (!el.isConnected || extractTweet(el)?.id !== post.id) return false;
    scan.commit(el, post.id);

    if (debug) {
      // Read-only: no decide(), so no fold and no automatic block.
      debugScores.set(el, { postId: post.id, result });
      mountDebugBadge(el, result, settings.threshold, t, post.id);
      return true;
    }

    const decision = decide(result, settings);
    if (decision.presentation === 'none') return false;

    mountResult(el, result, decision.presentation, {
      onExpand: () => {},
      onMute: () => {
        void muteUser({ article: el, screenName: post.handle, userId: post.userId }).then((r) => {
          toast(r.ok ? t('muteOk') : `${t('actionFail')}: ${r.detail || r.method}`);
        });
      },
      onBlock: () => {
        void blockUser({ article: el, screenName: post.handle, userId: post.userId }).then((r) => {
          toast(r.ok ? t('blockOk') : `${t('actionFail')}: ${r.detail || r.method}`);
        });
      },
    }, t, post.id);

    if (decision.autoBlock) scheduleAutoBlock(post, result.score);
    return true;
  }

  /**
   * Serialised auto block for strict mode.
   *
   * The queue can outlive the settings that filled it, so every item is
   * re-validated at dequeue time. Limits (interval, daily cap, meltdown) live
   * in auto-guard and span tabs and reloads; the durable ledger keys on userId
   * when we know it. Native-menu automation is never used here: it opens
   * popups and races with the user.
   */
  let autoQueue: Promise<void> = Promise.resolve();
  const autoSeen = new Set<string>();

  function skippedByPolicy(post: PostExtract): boolean {
    const handle = (post.handle || '').replace(/^@/, '').toLowerCase();
    if (
      settings.accountWhitelist.some(
        (h) => h.replace(/^@/, '').toLowerCase() === handle,
      )
    ) {
      return true;
    }
    return settings.skipOwnPosts && Boolean(post.isOwn);
  }

  function logAction(entry: AutoActionEntry): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      // The service worker writes serially; direct writes can race across tabs.
      chrome.runtime.sendMessage({ type: 'ANTI_SLOP_LOG_ACTION', entry }).catch(() => {
        void logAutoAction(entry);
      });
      return;
    }
    void logAutoAction(entry);
  }

  function scheduleAutoBlock(post: PostExtract, score: number): void {
    const key = (post.userId || post.handle || '').toLowerCase();
    if (!key || autoSeen.has(key)) return;
    autoSeen.add(key);

    autoQueue = autoQueue.then(async () => {
      const now = Date.now();
      // Re-check the world: the user may have changed mode or disabled us.
      if (!settings.enabled || settings.debugMode || settings.scanMode !== 'strict') return;
      if (skippedByPolicy(post)) return;
      if (await isHandled(key, now)) return;

      const reserved = await reserveAutoAction(now);
      if (!reserved.ok) {
        if (reserved.verdict.reason !== 'paused') {
          void logAutoAction({
            ts: now,
            action: 'block',
            handle: post.handle,
            postId: post.id,
            score,
            ok: false,
            detail: `skipped:${reserved.verdict.reason}`,
          });
        }
        return;
      }

      // Two storage round trips ran since the dequeue check; re-read the mode
      // right before the destructive call (TLA+ model: CallOnlyInStrict).
      if (!settings.enabled || settings.debugMode || settings.scanMode !== 'strict') return;

      const r = await blockUser({
        screenName: post.handle,
        userId: post.userId,
        preferApi: true,
      });

      if (r.ok) await markHandled(key, now);
      else if (r.status === 403 || r.status === 429) {
        // X is pushing back: stop automatic actions instead of retrying into it.
        await pauseAutoActions(now + MELTDOWN_MS);
        toast(t('autoPaused'));
      }

      logAction({
        ts: now,
        action: 'block',
        handle: post.handle,
        postId: post.id,
        score,
        ok: r.ok,
        detail: r.ok ? undefined : r.detail || r.method,
      });
      toast(
        r.ok ? `${t('autoBlocked')} @${post.handle}` : `${t('actionFail')}: ${r.detail || r.method}`,
      );
    });
  }

  /** Returns how many posts were actually scored, so the popup can report it. */
  async function scanVisible(force = false): Promise<number> {
    if (!settings.enabled) return 0;
    if (!settings.autoScan && !force && !settings.debugMode) return 0;
    const results = await Promise.all(listTweets().map((tweet) => handleArticle(tweet.el, force)));
    return results.filter(Boolean).length;
  }

  const mo = new MutationObserver(() => {
    if (settings.autoScan || settings.debugMode) void scanVisible(false);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Viewport trigger
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.target instanceof HTMLElement) {
          void handleArticle(e.target, false);
        }
      }
    },
    { root: null, rootMargin: '100px', threshold: 0.05 },
  );

  const watch = () => {
    for (const tweet of listTweets()) {
      io.observe(tweet.el);
    }
  };
  watch();
  setInterval(watch, 2000);

  if (settings.autoScan || settings.debugMode) void scanVisible(false);

  // Expose for manual debug
  (globalThis as unknown as { __antiSlopScan?: () => void }).__antiSlopScan = () => {
    for (const tweet of listTweets()) clearMounted(tweet.el);
    void scanVisible(true);
  };
}

/** Restore every article this script has touched (folded or badged). */
function unmountAll(): void {
  document
    .querySelectorAll<HTMLElement>('[data-anti-slop]')
    .forEach((el) => clearMounted(el));
}

function isInViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < (window.innerHeight || 800) + 120;
}

function toast(msg: string) {
  const n = document.createElement('div');
  n.textContent = msg;
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
