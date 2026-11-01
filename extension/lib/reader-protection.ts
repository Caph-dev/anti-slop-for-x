/**
 * Never collapse what the user may be reading.
 *
 * A visible post is protected immediately. Once it has been on screen for
 * `graceMs`, it remains protected as seen after it leaves the screen. Folding
 * such a post is turned into a mark instead. A user's own Fold / Show click is
 * never blocked.
 *
 * Keys are post ids: X recycles article nodes, so node identity would carry
 * one post's reading history over to another.
 */
export const READ_GRACE_MS = 600;
const MAX_SEEN = 5000;

export interface ReaderProtection {
  /** The post is on screen (again). Keeps the earliest start of this visit. */
  enter(postId: string, now: number): void;
  /** The post left the screen; a long enough visit marks it seen. */
  leave(postId: string, now: number): void;
  /** The user interacted with it (for example expanded it). */
  markSeen(postId: string): void;
  /** True when folding it now would collapse something visible or already seen. */
  protects(postId: string, now: number): boolean;
}

export function createReaderProtection(graceMs = READ_GRACE_MS): ReaderProtection {
  const since = new Map<string, number>();
  const seen = new Set<string>();
  const remember = (postId: string) => {
    seen.delete(postId);
    seen.add(postId);
    if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value!);
  };
  return {
    enter(postId, now) {
      if (!since.has(postId)) since.set(postId, now);
    },
    leave(postId, now) {
      const start = since.get(postId);
      if (start !== undefined && now - start >= graceMs) remember(postId);
      since.delete(postId);
    },
    markSeen(postId) {
      remember(postId);
    },
    protects(postId) {
      return seen.has(postId) || since.has(postId);
    },
  };
}
