import { defineBackground } from 'wxt/utils/define-background';
import { addKeptAccount, loadSettings, parseSettingsPatch, updateSettings } from '../lib/settings';
import { applyRuleEdits, parseRuleEdits, RuleListLimitError } from '../lib/account-rules';
import { requestFingerprint } from '../lib/scorer';
import { markActionUndone } from '../lib/action-log';
import { isRecognitionSender, serveRecognition } from '../lib/recognition-service';

function isSettingsSender(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId &&
      (url.pathname === '/popup.html' || url.pathname === '/options.html');
  } catch {
    return false;
  }
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void loadSettings();
  });

  // The toolbar icon opens the popup entrypoint (entrypoints/popup), which
  // offers "Scan current page" and "Options". Chrome does not fire
  // action.onClicked while a default_popup is set, so there is no listener here.

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'ANTI_SLOP_SAVE_SETTINGS') {
      const patch = isSettingsSender(sender, chrome.runtime.id) ? parseSettingsPatch(msg.patch) : null;
      const ruleEdits = patch ? parseRuleEdits(msg.ruleEdits) : null;
      const configKeys = ['apiKey', 'endpointPreset', 'protocol', 'upstreamBaseUrl', 'upstreamPath', 'model'];
      const changesConfig = patch && configKeys.some((key) => Object.hasOwn(patch, key));
      if (!patch || !ruleEdits || (changesConfig && typeof msg.expectedFingerprint !== 'string') ||
        (msg.expectedFingerprint !== undefined && typeof msg.expectedFingerprint !== 'string')) {
        sendResponse({ ok: false });
        return false;
      }
      let stale = false;
      void updateSettings((current) => {
        if (msg.expectedFingerprint !== undefined && requestFingerprint(current) !== msg.expectedFingerprint) {
          stale = true;
          throw new Error('stale');
        }
        return { ...patch, ...applyRuleEdits(current, ruleEdits) };
      }).then((settings) => sendResponse({ ok: true, settings }))
        .catch((error: unknown) => sendResponse(stale ? { ok: false, reason: 'stale' } :
          error instanceof RuleListLimitError ? { ok: false, reason: 'rules_limit' } : { ok: false }));
      return true;
    }
    if (msg?.type === 'ANTI_SLOP_RECOGNIZE') {
      if (!isRecognitionSender(sender, chrome.runtime.id)) {
        sendResponse({ ok: false, reason: 'invalid_request' });
        return false;
      }
      // Content-script fetches are subject to the page's CORS policy; the
      // service worker with host permission is not. Settings (and the key) are
      // read here, never taken from the message.
      void serveRecognition(msg, {
        loadSettings,
        hasOriginAccess: (pattern) => chrome.permissions.contains({ origins: [pattern] }),
      })
        .then((reply) => sendResponse(reply))
        .catch(() => sendResponse({ ok: false, reason: 'internal' }));
      return true;
    }
    if (msg?.type === 'ANTI_SLOP_KEEP_ACCOUNT') {
      if (!isRecognitionSender(sender, chrome.runtime.id)) {
        sendResponse({ ok: false });
        return false;
      }
      // A local keep rule only; nothing is sent to X.
      void addKeptAccount(String(msg.handle ?? ''))
        .then((ok) => sendResponse({ ok }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (msg?.type === 'ANTI_SLOP_UNDO_BLOCK') {
      if (!isSettingsSender(sender, chrome.runtime.id) || new URL(sender.url!).pathname !== '/popup.html') {
        sendResponse({ ok: false });
        return false;
      }
      // Unblocking must run on an x.com page: only that origin carries the
      // session cookies and csrf token the API needs. Entries come from
      // versions that still had automatic blocking.
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
            // An undo means "this was a false positive": keep the account by
            // adding it to the visible keep list.
            await addKeptAccount(String(msg.handle));
          }
          sendResponse(res ?? { ok: false, error: 'no-response' });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
    return false;
  });
});
