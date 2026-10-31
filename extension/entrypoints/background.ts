import { defineBackground } from 'wxt/utils/define-background';
import { loadSettings, saveSettings } from '../lib/settings';
import { decideUpstream, UpstreamError } from '../lib/upstream-client';
import { logAutoAction, markActionUndone, type AutoActionEntry } from '../lib/action-log';
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
    if (msg?.type === 'ANTI_SLOP_UNDO_BLOCK') {
      // Unblocking must run on an x.com page: only that origin carries the
      // session cookies and csrf token the API needs.
      void (async () => {
        try {
          const tabs = await chrome.tabs.query({
            url: ['https://x.com/*', 'https://twitter.com/*'],
          });
          const tab = tabs.find((t) => t.id != null);
          if (!tab?.id) {
            sendResponse({ ok: false, error: 'no-x-tab' });
            return;
          }
          const res = (await chrome.tabs.sendMessage(tab.id, {
            type: 'ANTI_SLOP_UNBLOCK',
            handle: msg.handle,
          })) as { ok?: boolean; detail?: string } | undefined;

          if (res?.ok) {
            await markActionUndone(Number(msg.ts), String(msg.handle));
            // An undo means "this was a false positive": keep the account out
            // of strict mode's reach by adding it to the visible whitelist.
            const settings = await loadSettings();
            const handle = String(msg.handle).replace(/^@/, '').toLowerCase();
            const known = settings.accountWhitelist.map((h) =>
              h.replace(/^@/, '').toLowerCase(),
            );
            if (handle && !known.includes(handle)) {
              await saveSettings({ accountWhitelist: [...settings.accountWhitelist, handle] });
            }
          }
          sendResponse(res ?? { ok: false, error: 'no-response' });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
    if (msg?.type === 'ANTI_SLOP_LOG_ACTION') {
      // One writer for the action log: parallel content scripts would race on
      // read-modify-write and drop entries.
      void logAutoAction(msg.entry as AutoActionEntry)
        .then(() => sendResponse({ ok: true }))
        .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }));
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
