import type { DecisionResult } from './types';

const cache = new Map<string, DecisionResult>();
const MAX = 500;

export function getCached(postId: string): DecisionResult | undefined {
  return cache.get(postId);
}

export function setCached(postId: string, result: DecisionResult): void {
  if (cache.size >= MAX) {
    const first = cache.keys().next().value;
    if (first != null) cache.delete(first);
  }
  cache.set(postId, result);
}

/**
 * Drop cached decisions. With `prefix`, only that namespace is dropped —
 * debug mode keeps its scores under `debug:` so they never mix with the
 * normal fold path in either direction.
 */
export function clearCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
