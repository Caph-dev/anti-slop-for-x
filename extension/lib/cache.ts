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

export function clearCache(): void {
  cache.clear();
}
