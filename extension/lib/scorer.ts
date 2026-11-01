/**
 * Recognition request identity, admission and the page-owned cache.
 *
 * Shared by the content script (scheduling, cache, rendering) and the
 * background (re-check right before transport). There is no score and no local
 * fallback: a post is either sent to the explicitly configured Responses
 * endpoint, or it gets a local `unavailable` / `abstained` state that says why
 * nothing was sent.
 */
import { RESPONSES_PROMPT_VERSION, RESPONSES_SCHEMA_VERSION } from './adapters/openai-responses';
import { resolveEndpoint } from './endpoints';
import {
  RECOGNITION_SOURCES,
  isCacheable,
  missingRequired,
  recognitionContext,
  type Recognition,
  type RecognitionInput,
  type RecognitionUnavailableReason,
} from './recognition';
import { endpointUrl } from './recognizer-client';
import { userRule, type UserRule } from './mode';
import type { Settings } from './types';
import { X_EXTRACTOR_VERSION } from './x/dom';

/** Bump when the rules that decide which context is proven or required change. */
export const CONTEXT_POLICY_VERSION = 'proven-context-2';

export const RECOGNITION_VERSIONS = {
  prompt: RESPONSES_PROMPT_VERSION,
  schema: RESPONSES_SCHEMA_VERSION,
  extractor: X_EXTRACTOR_VERSION,
  context: CONTEXT_POLICY_VERSION,
} as const;

/** Deterministic text of exactly what would be sent about a post. */
export function canonicalInput(input: RecognitionInput): string {
  return JSON.stringify({
    sources: RECOGNITION_SOURCES.map((source) => {
      const slot = input.sources[source];
      if (slot.state === 'available') return [source, slot.state, slot.text];
      if (slot.state === 'partial') return [source, slot.state, slot.text, [...slot.gaps].sort()];
      return [source, slot.state];
    }),
    required: RECOGNITION_SOURCES.filter((source) => input.required.includes(source)),
  });
}

/**
 * Where and how a request goes, without secrets: protocol, effective URL,
 * model, the prompt / schema / extractor / context versions and the opaque
 * credential revision. Any change here means old results do not apply.
 */
export function requestFingerprint(settings: Settings): string {
  const endpoint = resolveEndpoint(settings);
  return JSON.stringify({
    versions: RECOGNITION_VERSIONS,
    protocol: endpoint.protocol,
    url: endpointUrl(endpoint.baseUrl || '', endpoint.path || '') ?? `invalid:${endpoint.baseUrl}|${endpoint.path}`,
    model: (endpoint.model || '').trim(),
    credential: settings.credentialRevision,
  });
}

/** Request identity: body, proven context and fingerprint. Memory only. */
export function recognitionIdentity(input: RecognitionInput, fingerprint: string): string {
  return `${fingerprint}\n${canonicalInput(input)}`;
}

export type ConfigProblem = Extract<RecognitionUnavailableReason,
  'user_opted_out' | 'unsupported_protocol' | 'missing_key' | 'missing_model' | 'invalid_config'>;

/** The first reason recognition cannot run with these settings, or null. */
export function configProblem(settings: Settings): ConfigProblem | null {
  if (settings.prefilterOnly) return 'user_opted_out';
  const endpoint = resolveEndpoint(settings);
  if (endpoint.protocol !== 'openai-responses') return 'unsupported_protocol';
  if (!(settings.apiKey || '').trim()) return 'missing_key';
  if (!(endpoint.model || '').trim()) return 'missing_model';
  if (!endpointUrl(endpoint.baseUrl || '', endpoint.path || '')) return 'invalid_config';
  return null;
}

export interface AdmissionSubject {
  isOwn: boolean | null;
  input: RecognitionInput;
}

export interface TransportSubject {
  handle: string;
  isOwn: boolean | null;
  replyScoped: boolean;
  automatic: boolean;
}

function postLength(input: RecognitionInput): number {
  const post = input.sources.post;
  return post.state === 'available' || post.state === 'partial' ? post.text.trim().length : 0;
}

/**
 * Everything decided before any network: user opt-outs and rules, no-send
 * preferences, configuration problems and missing required context. A non-null
 * result means the post is not sent. Debug and manual scans go through here too.
 */
export function admission(subject: AdmissionSubject, settings: Settings, rule: UserRule): Recognition | null {
  const context = recognitionContext(subject.input);
  const unavailable = (reason: RecognitionUnavailableReason): Recognition => ({ status: 'unavailable', reason, context });
  if (!settings.enabled) return unavailable('disabled');
  if (settings.prefilterOnly) return unavailable('user_opted_out');
  if (settings.skipOwnPosts && subject.isOwn !== false) {
    return unavailable(subject.isOwn === null ? 'own_identity_unknown' : 'own_post_preference');
  }
  if (rule === 'keep') return unavailable('keep_rule');
  if (rule === 'hide') return unavailable('hide_rule');
  if (settings.skipShortText && postLength(subject.input) < settings.shortTextMaxChars) {
    return unavailable('short_text_preference');
  }
  const problem = configProblem(settings);
  if (problem) return unavailable(problem);
  const missing = missingRequired(subject.input);
  if (missing.length) return { status: 'abstained', cause: 'missing_context', missing, context };
  return null;
}

/** Re-evaluate local rules and no-send preferences at the transport boundary. */
export function transportExclusion(input: RecognitionInput, settings: Settings, subject: TransportSubject): Recognition | null {
  return admission({ isOwn: subject.isOwn, input }, settings, userRule(subject, settings));
}

export interface RecognitionTransport {
  id: string;
  latencyMs: number;
}

export type RecognizeReply =
  | { ok: true; result: Recognition; transport?: RecognitionTransport }
  | { ok: false; reason: 'stale' | 'invalid_request' | 'internal' };

export interface Recognizer {
  get(identity: string): Recognition | undefined;
  /** Stores valid judgments only; failures are never cached. */
  store(identity: string, result: Recognition): void;
  /** One transport per identity at a time; concurrent callers share it. Never caches. */
  run(identity: string, send: () => Promise<RecognizeReply>): Promise<RecognizeReply>;
  /** Invalidates pending work without discarding reusable judgments. */
  invalidatePending(): void;
  clear(): void;
  readonly size: number;
}

/** Page-owned: one per content-script instance, gone with the page. */
export function createRecognizer(limit = 500): Recognizer {
  const cache = new Map<string, Recognition>();
  const inFlight = new Map<string, Promise<RecognizeReply>>();
  return {
    get(identity) {
      const hit = cache.get(identity);
      if (hit) {
        cache.delete(identity);
        cache.set(identity, hit);
      }
      return hit;
    },
    store(identity, result) {
      if (!isCacheable(result)) return;
      cache.delete(identity);
      cache.set(identity, result);
      while (cache.size > limit) cache.delete(cache.keys().next().value!);
    },
    run(identity, send) {
      const pending = inFlight.get(identity);
      if (pending) return pending;
      const started = Promise.resolve().then(send);
      const tracked = started.finally(() => {
        if (inFlight.get(identity) === tracked) inFlight.delete(identity);
      });
      inFlight.set(identity, tracked);
      return tracked;
    },
    invalidatePending() {
      inFlight.clear();
    },
    clear() {
      cache.clear();
      inFlight.clear();
    },
    get size() {
      return cache.size;
    },
  };
}

/**
 * Content → background. The background reloads settings, re-checks the
 * fingerprint and exclusions, and only then calls the provider. A failure to
 * reach the background is a `network` failure, never a fallback.
 */
export async function sendRecognition(input: RecognitionInput, fingerprint: string, subject: TransportSubject): Promise<RecognizeReply> {
  const failed: RecognizeReply = { ok: true, result: { status: 'failed', error: 'network', context: recognitionContext(input) } };
  try {
    const reply = (await chrome.runtime.sendMessage({ type: 'ANTI_SLOP_RECOGNIZE', input, fingerprint, subject })) as unknown;
    if (reply && typeof reply === 'object' && 'ok' in reply) {
      const value = reply as RecognizeReply;
      if (value.ok && value.result && typeof value.result === 'object' && 'status' in value.result) return value;
      if (!value.ok && (value.reason === 'stale' || value.reason === 'invalid_request' || value.reason === 'internal')) return value;
    }
    return failed;
  } catch {
    return failed;
  }
}
