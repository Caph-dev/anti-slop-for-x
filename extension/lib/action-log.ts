/** Append-only log of automatic mute/block actions, capped and newest-first. */

export interface AutoActionEntry {
  /** ms since epoch */
  ts: number;
  action: 'mute' | 'block';
  handle: string;
  postId: string;
  score: number;
  ok: boolean;
  detail?: string;
  /** Set when the user undid this action from the popup. */
  undone?: boolean;
}

const KEY = 'antiSlopActionLog';
export const ACTION_LOG_LIMIT = 50;

export function actionLogKey(): string {
  return KEY;
}

export async function readActionLog(): Promise<AutoActionEntry[]> {
  const stored = await chrome.storage.local.get(KEY);
  const list = stored[KEY];
  return Array.isArray(list) ? (list as AutoActionEntry[]) : [];
}

export async function logAutoAction(entry: AutoActionEntry): Promise<void> {
  const list = await readActionLog();
  list.unshift(entry);
  await chrome.storage.local.set({ [KEY]: list.slice(0, ACTION_LOG_LIMIT) });
}

/** Flag the entry for (ts, handle) as undone. */
export async function markActionUndone(ts: number, handle: string): Promise<void> {
  const list = await readActionLog();
  let changed = false;
  for (const entry of list) {
    if (entry.ts === ts && entry.handle === handle) {
      entry.undone = true;
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ [KEY]: list });
}

export async function clearActionLog(): Promise<void> {
  await chrome.storage.local.set({ [KEY]: [] });
}
