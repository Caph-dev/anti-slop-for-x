/**
 * Scanning bookkeeping for the content script: which nodes are already done,
 * which have a score in flight, and whether a result still belongs to the
 * current settings.
 *
 * Pure state — no DOM, no chrome APIs — because the interesting bugs here are
 * async interleavings: a score that returns after the user toggled debug mode,
 * two scans submitting the same node, a stale task clearing a newer one's
 * registration. Keeping it separate makes those testable in plain Node.
 */

export interface ScanTicket {
  /** Identifies this registration; a newer task on the same node has another. */
  readonly id: number;
  readonly postId: string;
  /** Settings generation the score was started under. */
  readonly generation: number;
}

export interface ScanState {
  readonly generation: number;
  /** This node already rendered this post. */
  isProcessed(node: object, postId: string): boolean;
  /** Register an in-flight score; null when the same node + post is in flight. */
  begin(node: object, postId: string): ScanTicket | null;
  /** Release only this registration, never a newer task's. */
  end(node: object, ticket: ScanTicket): void;
  /** The result still belongs to the current settings and may be rendered. */
  isCurrent(ticket: ScanTicket): boolean;
  /** Record that the node now shows this post. */
  commit(node: object, postId: string): void;
  /** Drop every in-flight ticket and every processed mark. */
  invalidate(): void;
}

export function createScanState(): ScanState {
  let generation = 0;
  let nextId = 1;
  let processed = new WeakMap<object, string>();
  let pending = new WeakMap<object, ScanTicket>();

  return {
    get generation() {
      return generation;
    },

    isProcessed(node, postId) {
      return processed.get(node) === postId;
    },

    begin(node, postId) {
      if (pending.get(node)?.postId === postId) return null;
      const ticket: ScanTicket = { id: nextId++, postId, generation };
      pending.set(node, ticket);
      return ticket;
    },

    end(node, ticket) {
      // A replaced pending map or a newer registration must survive a stale
      // task finishing: compare the ticket itself, not just the post id.
      if (pending.get(node) === ticket) pending.delete(node);
    },

    isCurrent(ticket) {
      return ticket.generation === generation;
    },

    commit(node, postId) {
      processed.set(node, postId);
    },

    invalidate() {
      generation++;
      processed = new WeakMap();
      pending = new WeakMap();
    },
  };
}
