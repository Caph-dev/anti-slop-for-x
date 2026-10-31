import { defineBackground } from 'wxt/utils/define-background';
import { loadSettings } from '../lib/settings';
import { decideUpstream, UpstreamError } from '../lib/upstream-client';
import type { PostExtract, Settings } from '../lib/types';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void loadSettings();
  });

  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'ANTI_SLOP_SCAN_NOW' });
    } catch {
      await chrome.runtime.openOptionsPage();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ANTI_SLOP_GET_SETTINGS') {
      void loadSettings().then((s) => sendResponse({ settings: s }));
      return true;
    }
    if (msg?.type === 'ANTI_SLOP_DECIDE') {
      void (async () => {
        try {
          const settings = (msg.settings as Settings) || (await loadSettings());
          const post = msg.post as PostExtract;
          const raw = await decideUpstream(post, settings);
          sendResponse({ ok: true, raw });
        } catch (e) {
          const err = e as UpstreamError;
          sendResponse({
            ok: false,
            error: err?.message || String(e),
            status: err?.status ?? 0,
            detail: err?.detail ?? '',
          });
        }
      })();
      return true;
    }
    return false;
  });
});
