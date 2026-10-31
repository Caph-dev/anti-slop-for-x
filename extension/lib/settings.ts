import { DEFAULT_SETTINGS, type Settings } from './types';
import { deriveEndpointPreset } from './endpoints';
import { STRICT_ENABLED } from './mode';

const KEY = 'antiSlopForXSettings';
/** Pre-rename chrome.storage.local key (temporary name slop-shield). Read once, then removed. */
const LEGACY_KEY = 'slopShieldSettings';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([KEY, LEGACY_KEY]);
  const current = stored[KEY] as Partial<Settings> | undefined;
  const legacy = stored[LEGACY_KEY] as Partial<Settings> | undefined;

  if (current) {
    if (legacy) await chrome.storage.local.remove(LEGACY_KEY);
    return normalize(current);
  }

  if (legacy) {
    await chrome.storage.local.set({ [KEY]: legacy });
    await chrome.storage.local.remove(LEGACY_KEY);
    return normalize(legacy);
  }

  return { ...DEFAULT_SETTINGS };
}

/**
 * Settings written before `endpointPreset` existed get one inferred from their
 * base URL + protocol, so an upgrade never silently repoints the upstream.
 *
 * A stored `strict` mode is downgraded while the feature is shelved. The stored
 * value is left alone, so re-enabling the feature restores the user's choice.
 */
function normalize(raw: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  if (raw.endpointPreset === undefined) {
    merged.endpointPreset = deriveEndpointPreset(raw);
  }
  if (merged.scanMode === 'strict' && !STRICT_ENABLED) {
    merged.scanMode = 'auto-fold';
  }
  return merged;
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
