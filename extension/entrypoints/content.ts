import { defineContentScript } from 'wxt/utils/define-content-script';
import { loadSettings } from '../lib/settings';
import { scorePost } from '../lib/scorer';
import { createLimiter } from '../lib/concurrency';
import {
  currentUserHandle,
  extractTweet,
  listTweets,
  parentCreatedAtMs,
  parentTextFor,
} from '../lib/x/dom';
import { blockUser, muteUser, unblockUser } from '../lib/x/mute-block';
import { alreadyMounted, clearMounted, mountResult } from '../lib/ui';
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
import type { PostExtract, Settings } from '../lib/types';

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
  let limiter = createLimiter(settings.maxConcurrency);
  const processed = new WeakSet<HTMLElement>();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    void loadSettings().then((s) => {
      settings = s;
      limiter = createLimiter(s.maxConcurrency);
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
    if (settings.scanScope === 'replies-only' && !tweet.isReply) {
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
    if (!force && (processed.has(el) || alreadyMounted(el))) return false;
    if (!isInViewport(el) && !force) return false;

    const post = await toExtract(el);
    if (!post) return false;
    processed.add(el);

    const result = await limiter.run(() => scorePost(post, settings));
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
    }, t);

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
      if (!settings.enabled || settings.scanMode !== 'strict') return;
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
    if (!settings.autoScan && !force) return 0;
    const results = await Promise.all(listTweets().map((tweet) => handleArticle(tweet.el, force)));
    return results.filter(Boolean).length;
  }

  const mo = new MutationObserver(() => {
    if (settings.autoScan) void scanVisible(false);
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

  if (settings.autoScan) void scanVisible(false);

  // Expose for manual debug
  (globalThis as unknown as { __antiSlopScan?: () => void }).__antiSlopScan = () => {
    for (const tweet of listTweets()) clearMounted(tweet.el);
    void scanVisible(true);
  };
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
