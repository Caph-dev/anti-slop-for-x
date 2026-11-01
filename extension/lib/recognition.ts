export const RECOGNITION_SOURCES = ['post', 'parent', 'root', 'quote'] as const;
export const RECOGNITION_CATEGORIES = ['normal', 'engagement_bait', 'generic_irrelevant', 'content_free_restatement'] as const;
/** What a source slot is missing. `media` covers images, video, GIFs, link cards and polls the model cannot see. */
export const CONTEXT_GAPS = ['truncated', 'media'] as const;
export type RecognitionSource = typeof RECOGNITION_SOURCES[number];
export type Category = typeof RECOGNITION_CATEGORIES[number];
export type ContextGap = typeof CONTEXT_GAPS[number];
/**
 * - `available`: the complete text of a source proven to belong to this post.
 * - `partial`: some text, known to be incomplete (truncated, or with media the model cannot see).
 * - `missing`: the source exists but was not supplied (for example an unproven reply parent).
 * - `unknown`: it cannot be told from the page whether the source exists.
 * - `not-applicable`: the source does not exist.
 */
export type ContextSlot =
  | { state: 'available'; text: string }
  | { state: 'partial'; text: string; gaps: ContextGap[] }
  | { state: 'missing' | 'unknown' | 'not-applicable' };
export type ContextSlotState = ContextSlot['state'];
export interface RecognitionInput {
  sources: Record<RecognitionSource, ContextSlot>;
  required: RecognitionSource[];
}
export interface Evidence {
  source: RecognitionSource;
  quote: string;
}
export type ContextState = Record<RecognitionSource, ContextSlotState>;
/** Nothing was sent. Each reason is either a user preference or an actionable configuration problem. */
export type RecognitionUnavailableReason =
  | 'disabled' | 'user_opted_out' | 'short_text_preference' | 'own_post_preference' | 'own_identity_unknown' | 'keep_rule' | 'hide_rule'
  | 'unsupported_protocol' | 'missing_key' | 'missing_model' | 'invalid_config' | 'permission';
export type RecognitionError = 'timeout' | 'rate_limited' | 'authentication' | 'network' | 'http' | 'refusal' | 'incomplete' | 'invalid_json' | 'invalid_output' | 'invalid_provenance' | 'internal';
type Details = { reason: string; evidence: Evidence[]; counterevidence: Evidence[]; context: ContextState };
export type Recognition =
  | (Details & { status: 'classified'; category: Category })
  | (Details & { status: 'abstained'; cause: 'model' })
  | { status: 'abstained'; cause: 'missing_context'; missing: RecognitionSource[]; context: ContextState }
  | { status: 'unavailable'; reason: RecognitionUnavailableReason; context: ContextState }
  | { status: 'failed'; error: RecognitionError; context: ContextState };

const sources: readonly RecognitionSource[] = RECOGNITION_SOURCES;
const categories: readonly Category[] = RECOGNITION_CATEGORIES;
const gapNames: readonly string[] = CONTEXT_GAPS;
const maxReasonLength = 2000;
const maxExcerptsPerList = 10;
const maxExcerptLength = 500;
/** Upper bound for one source's text in a request. Longer text is cut and marked `truncated` by the extractor. */
export const MAX_SOURCE_CHARS = 8000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

// Normalize to NFC, replace each run of ECMAScript whitespace with one ASCII space,
// and trim leading/trailing whitespace. Matching remains case-sensitive.
function normalize(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function recognitionContext(input: RecognitionInput): ContextState {
  return Object.fromEntries(sources.map((source) => [source, input.sources[source].state])) as ContextState;
}

/** Sources a judgment of this input needs but does not have in full. */
export function missingRequired(input: RecognitionInput): RecognitionSource[] {
  const required = new Set<RecognitionSource>(['post', ...input.required]);
  return sources.filter((source) => required.has(source) && input.sources[source].state !== 'available');
}

export type TargetCategory = Exclude<Category, 'normal'>;
export type TargetRecognition = Extract<Recognition, { status: 'classified' }> & { category: TargetCategory };

/** A classified, non-normal category. Abstentions and failures are never targets. */
export function isTarget(result: Recognition): result is TargetRecognition {
  return result.status === 'classified' && result.category !== 'normal';
}

/** Only valid judgments may be reused; failures and local states are recomputed. */
export function isCacheable(result: Recognition): boolean {
  return result.status === 'classified' || (result.status === 'abstained' && result.cause === 'model');
}

/**
 * Structural validation for an input received over extension messaging. Drops
 * any extra field (handles, ids, keys) so only source text and states remain.
 */
export function parseRecognitionInput(value: unknown): RecognitionInput | null {
  if (!record(value) || !record(value.sources) || !Array.isArray(value.required)) return null;
  const parsed = {} as Record<RecognitionSource, ContextSlot>;
  for (const source of sources) {
    const slot = value.sources[source];
    if (!record(slot)) return null;
    if ((slot.state === 'available' || slot.state === 'partial') &&
      (typeof slot.text !== 'string' || !slot.text.trim() || slot.text.length > MAX_SOURCE_CHARS)) return null;
    if (slot.state === 'available') parsed[source] = { state: 'available', text: slot.text as string };
    else if (slot.state === 'partial') {
      if (!Array.isArray(slot.gaps) || !slot.gaps.length || !slot.gaps.every((gap) => typeof gap === 'string' && gapNames.includes(gap))) return null;
      parsed[source] = { state: 'partial', text: slot.text as string, gaps: [...new Set(slot.gaps as ContextGap[])] };
    } else if (slot.state === 'missing' || slot.state === 'unknown' || slot.state === 'not-applicable') {
      parsed[source] = { state: slot.state };
    } else return null;
  }
  if (!value.required.every((source) => typeof source === 'string' && sources.includes(source as RecognitionSource))) return null;
  return { sources: parsed, required: sources.filter((source) => (value.required as unknown[]).includes(source)) };
}

/** Validates literal provenance, not whether the cited text supports the judgment. */
export function parseRecognition(output: unknown, input: RecognitionInput): Recognition {
  const context = recognitionContext(input);
  const fail = (error: 'invalid_json' | 'invalid_output' | 'invalid_provenance'): Recognition => ({ status: 'failed', error, context });
  if (typeof output === 'string') {
    try { output = JSON.parse(output) as unknown; } catch { return fail('invalid_json'); }
  }
  if (!record(output) || (output.verdict !== 'classified' && output.verdict !== 'abstained')) return fail('invalid_output');
  const isClassified = output.verdict === 'classified';
  if (!exactKeys(output, ['verdict', 'category', 'reason', 'evidence', 'counterevidence']) ||
    typeof output.reason !== 'string' || !output.reason.trim() || output.reason.length > maxReasonLength ||
    !Array.isArray(output.evidence) || !Array.isArray(output.counterevidence) ||
    output.evidence.length > maxExcerptsPerList || output.counterevidence.length > maxExcerptsPerList ||
    [...output.evidence, ...output.counterevidence].some((item: unknown) => record(item) && typeof item.quote === 'string' && item.quote.length > maxExcerptLength) ||
    (isClassified ? (typeof output.category !== 'string' || !categories.includes(output.category as Category)) : output.category !== null)) {
    return fail('invalid_output');
  }
  const category = isClassified ? output.category as Category : undefined;
  const comparison = category === 'generic_irrelevant' || category === 'content_free_restatement';
  const required = new Set<RecognitionSource>(['post', ...input.required]);
  if (comparison && input.sources.parent.state !== 'available' && input.sources.quote.state !== 'available') required.add('parent');
  const missing = sources.filter((source) => required.has(source) && input.sources[source].state !== 'available');
  if (missing.length) return { status: 'abstained', cause: 'missing_context', missing, context };

  const validate = (items: unknown[]): Evidence[] | null => {
    const result: Evidence[] = [];
    for (const item of items) {
      if (!record(item) || !exactKeys(item, ['source', 'quote']) ||
        typeof item.source !== 'string' || !sources.includes(item.source as RecognitionSource) ||
        typeof item.quote !== 'string' || !normalize(item.quote)) return null;
      const source = item.source as RecognitionSource;
      const slot = input.sources[source];
      // Partial text can still be quoted literally; absent text cannot.
      if (slot.state !== 'available' && slot.state !== 'partial') return null;
      const normalizedSource = normalize(slot.text);
      const normalizedQuote = normalize(item.quote);
      const offset = normalizedSource.indexOf(normalizedQuote);
      if (offset === -1) return null;
      result.push({ source, quote: normalizedSource.slice(offset, offset + normalizedQuote.length) });
    }
    return result;
  };
  const evidence = validate(output.evidence);
  const counterevidence = validate(output.counterevidence);
  if (!evidence || !counterevidence) return fail('invalid_provenance');
  if (isClassified && (!evidence.some((item) => item.source === 'post') ||
    (comparison && !evidence.some((item) => item.source === 'parent' || item.source === 'quote')))) {
    return fail('invalid_output');
  }
  const details = { reason: output.reason, evidence, counterevidence, context };
  if (category) return { status: 'classified', category, ...details };
  return { status: 'abstained', cause: 'model', ...details };
}
