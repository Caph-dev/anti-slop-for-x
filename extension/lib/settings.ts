import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'antiSlopForXSettings';
/** Pre-rename chrome.storage.local key (temporary name slop-shield). Read once, then removed. */
const LEGACY_KEY = 'slopShieldSettings';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([KEY, LEGACY_KEY]);
  const current = stored[KEY] as Partial<Settings> | undefined;
  const legacy = stored[LEGACY_KEY] as Partial<Settings> | undefined;

  if (current) {
    if (legacy) await chrome.storage.local.remove(LEGACY_KEY);
    return { ...DEFAULT_SETTINGS, ...current };
  }

  if (legacy) {
    await chrome.storage.local.set({ [KEY]: legacy });
    await chrome.storage.local.remove(LEGACY_KEY);
    return { ...DEFAULT_SETTINGS, ...legacy };
  }

  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function settingsKey(): string {
  return KEY;
}
