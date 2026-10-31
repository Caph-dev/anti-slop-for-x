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

function sameHandles(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (list: string[]) =>
    list.map((h) => h.replace(/^@/, '').toLowerCase()).sort();
  const left = norm(a);
  const right = norm(b);
  return left.every((handle, i) => handle === right[i]);
}

/**
 * True when an edit changes what `scorePost` would compute or cache. The
 * content script drops its cached scores only then; display-only edits
 * (threshold, scan mode, auto-scan) keep them and just re-render.
 *
 * `debugMode` is deliberately not part of this comparison: flipping it is a
 * separate axis with its own cache namespace, handled in the content script.
 */
export function scoringSettingsChanged(prev: Settings, next: Settings): boolean {
  return (
    prev.apiKey !== next.apiKey ||
    prev.model !== next.model ||
    prev.protocol !== next.protocol ||
    prev.endpointPreset !== next.endpointPreset ||
    prev.upstreamBaseUrl !== next.upstreamBaseUrl ||
    prev.upstreamPath !== next.upstreamPath ||
    prev.defaultPrompt !== next.defaultPrompt ||
    prev.prefilterOnly !== next.prefilterOnly ||
    prev.skipShortText !== next.skipShortText ||
    prev.shortTextMaxChars !== next.shortTextMaxChars ||
    prev.skipOwnPosts !== next.skipOwnPosts ||
    !sameHandles(prev.accountWhitelist, next.accountWhitelist)
  );
}
