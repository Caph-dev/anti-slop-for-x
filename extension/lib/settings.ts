import { DEFAULT_SETTINGS, type Settings } from './types';
import { deriveEndpointPreset } from './endpoints';
import { normalizeHandle, type RuleEdits } from './account-rules';

const KEY = 'antiSlopForXSettings';
/** Pre-rename chrome.storage.local key (temporary name slop-shield). */
const LEGACY_KEY = 'slopShieldSettings';

async function readStored(): Promise<{ value: Partial<Settings> | undefined; hasLegacy: boolean }> {
  const stored = await chrome.storage.local.get([KEY, LEGACY_KEY]);
  const current = stored[KEY] as Partial<Settings> | undefined;
  const legacy = stored[LEGACY_KEY] as Partial<Settings> | undefined;
  return { value: current || legacy, hasLegacy: Boolean(legacy) };
}

function freshDefaults(): Settings {
  return { ...DEFAULT_SETTINGS, accountWhitelist: [], accountHideList: [] };
}

export async function loadSettings(): Promise<Settings> {
  const { value } = await readStored();
  return value ? normalize(value) : freshDefaults();
}

/**
 * Prompts this extension used to ship. A stored value equal to one of them was
 * never edited by the user, so it may be shown as the current default; anything
 * else is a deliberate custom prompt and stays untouched. No prompt from this
 * field is sent by the Responses recognizer.
 */
const LEGACY_DEFAULT_PROMPTS = new Set([
  'does this look like AI engagement bait / bot reply on X',
]);

function handles(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((h): h is string => typeof h === 'string') : [];
}

/**
 * Effective settings for a stored object. Nothing here is written back:
 *
 * - settings saved before `endpointPreset` existed get one inferred from their
 *   base URL + protocol + path, so an upgrade never repoints the upstream (and
 *   never infers the Responses protocol);
 * - before 0.10 short texts were skipped by default, so a stored object with no
 *   `skipShortText` field keeps that no-send preference; new installs do not skip;
 * - automatic modes (`auto-fold`, `strict`) behave as `shadow` while automatic
 *   model folding is unavailable. The stored value stays until the user picks a mode;
 * - a stored prompt that equals an old shipped default shows the current one.
 */
function normalize(raw: Partial<Settings>): Settings {
  const merged: Settings = { ...DEFAULT_SETTINGS, ...raw };
  if (raw.endpointPreset === undefined) merged.endpointPreset = deriveEndpointPreset(raw);
  if (raw.skipShortText === undefined) merged.skipShortText = true;
  if (merged.scanMode !== 'manual') merged.scanMode = 'shadow';
  if (LEGACY_DEFAULT_PROMPTS.has((merged.defaultPrompt ?? '').trim())) {
    merged.defaultPrompt = DEFAULT_SETTINGS.defaultPrompt;
  }
  merged.accountWhitelist = handles(raw.accountWhitelist);
  merged.accountHideList = handles(raw.accountHideList);
  const revision = raw.credentialRevision;
  merged.credentialRevision = typeof revision === 'string' && /^[a-z0-9-]{1,64}$/i.test(revision)
    ? revision
    : typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  return merged;
}

/**
 * All production writes run in the background through this queue. Extension
 * pages use `saveSettingsViaBackground`; background-owned rule edits use the
 * same queue directly.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function write(change: (current: Settings) => Partial<Settings>): Promise<Settings> {
  const { value: stored, hasLegacy } = await readStored();
  // Merge into the stored object, not the normalized view, so legacy fields
  // the user did not edit keep their stored values.
  const base: Partial<Settings> = stored ?? freshDefaults();
  const current = normalize(base);
  const partial = { ...change(current) };
  delete partial.credentialRevision;
  const next: Partial<Settings> = { ...base, ...partial };
  next.credentialRevision = partial.apiKey !== undefined && partial.apiKey !== current.apiKey
    ? crypto.randomUUID()
    : current.credentialRevision;
  await chrome.storage.local.set({ [KEY]: next });
  if (hasLegacy) await chrome.storage.local.remove(LEGACY_KEY);
  return normalize(next);
}

export function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  return serialized(() => write(() => partial));
}

/** Extension pages send writes to the single background queue. */
export async function saveSettingsViaBackground(
  partial: Partial<Settings>, expectedFingerprint?: string, ruleEdits?: RuleEdits,
): Promise<Settings> {
  const message = {
    type: 'ANTI_SLOP_SAVE_SETTINGS',
    patch: partial,
    ...(expectedFingerprint === undefined ? {} : { expectedFingerprint }),
    ...(ruleEdits === undefined ? {} : { ruleEdits }),
  };
  const reply = await chrome.runtime.sendMessage(message) as
    { ok?: boolean; reason?: string; settings?: Settings } | undefined;
  if (!reply?.ok || !reply.settings) {
    throw new Error(reply?.reason === 'stale' || reply?.reason === 'rules_limit' ? reply.reason : 'Settings save failed');
  }
  return reply.settings;
}

/** Validate the fields accepted from extension pages; the credential revision is background-owned. */
export function parseSettingsPatch(value: unknown): Partial<Settings> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const patch: Partial<Settings> = {};
  const booleans = new Set(['enabled', 'autoScan', 'prefilterOnly', 'skipShortText', 'skipOwnPosts', 'debugMode']);
  const strings = new Set(['upstreamBaseUrl', 'upstreamPath', 'apiKey', 'model', 'defaultPrompt']);
  for (const [key, item] of Object.entries(value)) {
    if (booleans.has(key)) {
      if (typeof item !== 'boolean') return null;
    } else if (strings.has(key)) {
      if (typeof item !== 'string' || item.length > 100_000) return null;
    } else if (key === 'scanScope') {
      if (item !== 'replies-only' && item !== 'timeline-and-replies') return null;
    } else if (key === 'scanMode') {
      if (item !== 'manual' && item !== 'shadow' && item !== 'auto-fold' && item !== 'strict') return null;
    } else if (key === 'protocol') {
      if (item !== 'jev' && item !== 'openai-decisions' && item !== 'openai-responses') return null;
    } else if (key === 'endpointPreset') {
      if (item !== 'jev-official' && item !== 'openai-official' && item !== 'openai-responses' && item !== 'custom') return null;
    } else if (key === 'shortTextMaxChars' || key === 'maxConcurrency') {
      if (!Number.isSafeInteger(item) || (item as number) < 0 || (item as number) > 10_000) return null;
    } else if (key === 'threshold') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) return null;
    } else return null;
    Object.assign(patch, { [key]: item });
  }
  return patch;
}

/** Read-modify-write inside the same queue, for edits computed from the current value. */
export function updateSettings(change: (current: Settings) => Partial<Settings>): Promise<Settings> {
  return serialized(() => write(change));
}

/** Permanent keep: add the account to the local keep list. Never touches X. */
export async function addKeptAccount(handle: string): Promise<boolean> {
  const value = normalizeHandle(handle);
  if (!value) return false;
  await updateSettings((current) => {
    const known = current.accountWhitelist.map((h) => h.replace(/^@/, '').toLowerCase());
    return known.includes(value) ? {} : { accountWhitelist: [...current.accountWhitelist, value] };
  });
  return true;
}

export function settingsKey(): string {
  return KEY;
}

/**
 * True when an edit changes what a recognition request contains or where it
 * goes: endpoint, protocol, model or credential. Results computed under the old
 * value can never be shown for the new one. Admission (no-send preferences,
 * rules), scope, mode and debug are re-evaluated on every render instead.
 */
export function recognitionSettingsChanged(prev: Settings, next: Settings): boolean {
  return prev.credentialRevision !== next.credentialRevision || prev.apiKey !== next.apiKey ||
    prev.model !== next.model || prev.protocol !== next.protocol ||
    prev.endpointPreset !== next.endpointPreset || prev.upstreamBaseUrl !== next.upstreamBaseUrl ||
    prev.upstreamPath !== next.upstreamPath;
}
