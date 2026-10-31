import { defineBackground } from 'wxt/utils/define-background';
import { loadSettings } from '../lib/settings';
import { decideUpstream, UpstreamError } from '../lib/upstream-client';
import type { PostExtract, Settings } from '../lib/types';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void loadSettings();
  });

  // The toolbar icon opens the popup entrypoint (entrypoints/popup), which
  // offers "Scan current page" and "Options". Chrome does not fire
  // action.onClicked while a default_popup is set, so there is no listener here.

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
