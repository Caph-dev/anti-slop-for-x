import type { Settings } from './types';

const RULE_LISTS = ['accountWhitelist', 'accountHideList'] as const;
type RuleList = typeof RULE_LISTS[number];
type RuleLists = Pick<Settings, RuleList>;
export type RuleEdits = Partial<Record<RuleList, { add: string[]; remove: string[] }>>;

export class RuleListLimitError extends Error {}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

export function normalizeHandle(handle: string): string | null {
  const value = handle.trim().replace(/^@/, '');
  return HANDLE.test(value) ? value.toLowerCase() : null;
}

function key(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase();
}

export function validRuleHandle(handle: string): boolean {
  const normalized = normalizeHandle(handle);
  return normalized !== null && key(handle) === normalized;
}

function uniqueHandles(handles: string[]): string[] {
  const seen = new Set<string>();
  return handles.filter((handle) => {
    const identity = key(handle);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function diffRuleEdits(before: RuleLists, after: RuleLists): RuleEdits {
  const edits: RuleEdits = {};
  for (const list of RULE_LISTS) {
    const previous = new Set(before[list].map(key));
    const next = new Set(after[list].map(key));
    const add = uniqueHandles(after[list].filter((handle) => !previous.has(key(handle))));
    const remove = uniqueHandles(before[list].filter((handle) => !next.has(key(handle))));
    if (add.length || remove.length) edits[list] = { add, remove };
  }
  return edits;
}

function isHandleArray(value: unknown, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= 5000 &&
    value.every((handle) => typeof handle === 'string' && handle.length <= maxLength);
}

export function parseRuleEdits(value: unknown): RuleEdits | null {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const edits: RuleEdits = {};
  for (const [list, candidate] of Object.entries(value)) {
    if (list !== 'accountWhitelist' && list !== 'accountHideList') return null;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const record: Record<string, unknown> = candidate;
    if (!Object.hasOwn(record, 'add') || !Object.hasOwn(record, 'remove') ||
      Object.keys(record).some((field) => field !== 'add' && field !== 'remove') ||
      !isHandleArray(record.add, 16) || !isHandleArray(record.remove, Number.POSITIVE_INFINITY) ||
      record.add.some((handle) => !validRuleHandle(handle))) return null;
    const removed = new Set(record.remove.map(key));
    if (record.add.some((handle) => removed.has(key(handle)))) return null;
    edits[list] = { add: [...record.add], remove: [...record.remove] };
  }
  return edits;
}

export function applyRuleEdits(current: RuleLists, edits: RuleEdits): Partial<RuleLists> {
  const patch: Partial<RuleLists> = {};
  for (const list of RULE_LISTS) {
    const edit = edits[list];
    if (!edit) continue;
    const removed = new Set(edit.remove.map(key));
    const next = current[list].filter((handle) => !removed.has(key(handle)));
    const known = new Set(next.map(key));
    for (const handle of edit.add) {
      const identity = key(handle);
      if (!known.has(identity)) {
        next.push(handle);
        known.add(identity);
      }
    }
    if (next.length > Math.max(5000, current[list].length)) throw new RuleListLimitError();
    patch[list] = next;
  }
  return patch;
}
