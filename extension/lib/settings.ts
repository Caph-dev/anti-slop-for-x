import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'slopShieldSettings';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = stored[KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
}

export async function saveSettings( partial: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function settingsKey(): string {
  return KEY;
}
