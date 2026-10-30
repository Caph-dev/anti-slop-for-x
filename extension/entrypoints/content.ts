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
import { blockUser, muteUser } from '../lib/x/mute-block';
import { alreadyMounted, clearMounted, mountResult } from '../lib/ui';
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
    if (msg?.type === 'ANTI_SLOP_SCAN_NOW') {
      void scanVisible(true).then(() => sendResponse({ ok: true }));
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

  async function handleArticle(el: HTMLElement, force = false) {
    if (!settings.enabled) return;
    if (!force && (processed.has(el) || alreadyMounted(el))) return;
    if (!isInViewport(el) && !force) return;

    const post = await toExtract(el);
    if (!post) return;
    processed.add(el);

    const result = await limiter.run(() => scorePost(post, settings));
    mountResult(el, result, settings.threshold, {
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
  }

  async function scanVisible(force = false) {
    if (!settings.enabled) return;
    if (!settings.autoScan && !force) return;
    for (const tweet of listTweets()) {
      void handleArticle(tweet.el, force);
    }
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
