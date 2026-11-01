/**
 * Per-tab record of what happened to each recognized post: status, reason
 * codes, the presentation that was applied and the shadow counterfactual.
 *
 * Ephemeral by design: it lives in the content script's memory and is gone
 * when the tab reloads or closes, so there is no cross-tab storage race and
 * nothing accumulates. Entries hold enum codes only. A post id is used as an
 * in-memory deduplication key, but is not returned or persisted. No post text,
 * author, key, URL, model rationale, quoted evidence or raw output is stored.
 */
import type { DecisionReason, Presentation, UserRule } from './mode';
import type { Category, ContextState, Recognition } from './recognition';
import type { RecognitionTransport } from './scorer';

export interface DiagnosticEntry {
  status: Recognition['status'];
  /** Category, abstention cause, unavailable reason or failure code. */
  code: string;
  mode: 'manual' | 'shadow';
  presentation: Presentation;
  counterfactual: 'keep' | 'fold';
  decision: DecisionReason;
  rule: UserRule;
  context: ContextState;
}

export interface DiagnosticsSnapshot {
  /** Counts and mean end-to-end latency of model request attempts in this tab. */
  modelCalls: number;
  meanLatencyMs: number | null;
  /** Posts recorded in this tab (latest outcome per post). */
  total: number;
  /** `status:code` → count, for example `failed:rate_limited`. */
  outcomes: Record<string, number>;
  /** How many model targets a fold-everything-flagged policy would fold. */
  counterfactualFolds: number;
  /** Presentations actually applied to posts. */
  presented: Record<Presentation, number>;
  /** "Not accurate" reports per category, this tab only. */
  reports: Partial<Record<Category, number>>;
  /** Newest first. */
  recent: DiagnosticEntry[];
  limit: number;
}

export function outcomeCode(result: Recognition): string {
  switch (result.status) {
    case 'classified': return result.category;
    case 'abstained': return result.cause;
    case 'unavailable': return result.reason;
    case 'failed': return result.error;
  }
}

export interface Diagnostics {
  record(key: string, entry: DiagnosticEntry): void;
  recordTransport(transport: RecognitionTransport): void;
  report(category: Category): void;
  snapshot(recent?: number): DiagnosticsSnapshot;
}

export function createDiagnostics(limit = 300): Diagnostics {
  const entries = new Map<string, DiagnosticEntry>();
  const reports: Partial<Record<Category, number>> = {};
  const requests = new Set<string>();
  let modelCalls = 0;
  let totalLatencyMs = 0;
  return {
    record(key, entry) {
      const copy: DiagnosticEntry = {
        status: entry.status,
        code: entry.code,
        mode: entry.mode,
        presentation: entry.presentation,
        counterfactual: entry.counterfactual,
        decision: entry.decision,
        rule: entry.rule,
        context: { ...entry.context },
      };
      entries.delete(key);
      entries.set(key, copy);
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
    },
    recordTransport(transport) {
      if (requests.has(transport.id) || !Number.isFinite(transport.latencyMs) || transport.latencyMs < 0) return;
      requests.add(transport.id);
      if (requests.size > 5000) requests.delete(requests.values().next().value!);
      modelCalls++;
      totalLatencyMs += transport.latencyMs;
    },
    report(category) {
      reports[category] = (reports[category] ?? 0) + 1;
    },
    snapshot(recent = 20) {
      const list = Array.from(entries.values());
      const outcomes: Record<string, number> = {};
      const presented: Record<Presentation, number> = { none: 0, advisory: 0, diagnostic: 0, fold: 0 };
      let counterfactualFolds = 0;
      for (const entry of list) {
        const code = `${entry.status}:${entry.code}`;
        outcomes[code] = (outcomes[code] ?? 0) + 1;
        presented[entry.presentation]++;
        if (entry.counterfactual === 'fold') counterfactualFolds++;
      }
      return {
        modelCalls,
        meanLatencyMs: modelCalls ? Math.round(totalLatencyMs / modelCalls) : null,
        total: list.length,
        outcomes,
        counterfactualFolds,
        presented,
        reports: { ...reports },
        recent: list.slice(-recent).reverse().map((entry) => ({ ...entry, context: { ...entry.context } })),
        limit,
      };
    },
  };
}
