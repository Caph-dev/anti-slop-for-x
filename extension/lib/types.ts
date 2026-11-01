/** Shared types for Anti Slop for X */
import { DEFAULT_PROMPT } from './prompt';

export type ProtocolType = 'jev' | 'openai-decisions' | 'openai-responses';

/**
 * Which upstream the extension talks to. A preset carries its own base URL /
 * path / protocol (and a default model); `custom` uses the user's fields.
 * Only the `openai-responses` protocol can return checkable evidence; the
 * Jev and Decisions protocols are kept selectable but report "unsupported".
 */
export type EndpointPreset = 'jev-official' | 'openai-official' | 'openai-responses' | 'custom';

export type ScanScope = 'replies-only' | 'timeline-and-replies';

/**
 * - `manual`: mark possible low-quality posts with evidence; the user decides.
 * - `shadow`: record outcomes for this tab only; posts are never changed.
 * Legacy `auto-fold` / `strict` stay readable in storage and behave as `shadow`:
 * automatic model folding and automatic blocking are not available.
 */
export type ScanMode = 'manual' | 'shadow' | 'auto-fold' | 'strict';

export interface Settings {
  enabled: boolean;
  autoScan: boolean;
  scanScope: ScanScope;
  scanMode: ScanMode;
  /** Legacy score threshold, kept as stored. Recognition has no score and never reads it. */
  threshold: number;
  /** No-send preference: posts shorter than `shortTextMaxChars` are never sent. Not a quality judgment. */
  skipShortText: boolean;
  shortTextMaxChars: number;
  /** No-send preference for your own posts; they are also never marked. */
  skipOwnPosts: boolean;
  /** Legacy name for "model use off": nothing is sent, including manual scans and debug. */
  prefilterOnly: boolean;
  /** Per-post diagnostics in manual mode. Overrides autoScan, but obeys enable, scope, opt-out and shadow. */
  debugMode: boolean;
  /** Built-in endpoint preset, or `custom` to use the fields below. */
  endpointPreset: EndpointPreset;
  /** User's own model endpoint (used when endpointPreset is `custom`). */
  upstreamBaseUrl: string;
  upstreamPath: string;
  apiKey: string;
  model: string;
  protocol: ProtocolType;
  /** Legacy Jev / Decisions prompt. Preserved verbatim; never sent by the Responses recognizer. */
  defaultPrompt: string;
  /**
   * Opaque revision changed by `saveSettings` whenever `apiKey` changes. Request
   * identity uses it instead of the key, so a key change never reuses results.
   * Numbers are accepted for existing stored settings; new revisions are random.
   */
  credentialRevision: number | string;
  accountWhitelist: string[]; // explicit local keep rules, handles without @
  accountHideList: string[]; // explicit local hiding, never X blocking
  maxConcurrency: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  autoScan: true,
  scanScope: 'replies-only',
  scanMode: 'shadow',
  threshold: 0.55,
  skipShortText: false,
  shortTextMaxChars: 12,
  skipOwnPosts: true,
  prefilterOnly: false,
  debugMode: false,
  endpointPreset: 'jev-official',
  upstreamBaseUrl: 'https://api.typesafe.ai/v1',
  upstreamPath: '/systemone',
  apiKey: '',
  model: 'jev-latest',
  protocol: 'jev',
  defaultPrompt: DEFAULT_PROMPT,
  credentialRevision: 0,
  accountWhitelist: [],
  accountHideList: [],
  maxConcurrency: 4,
};

export interface PostExtract {
  id: string;
  handle: string;
  text: string;
  isReply: boolean;
  parentText?: string | null;
  /** ms since epoch if known */
  createdAtMs?: number | null;
  /** parent post createdAt if known */
  parentCreatedAtMs?: number | null;
  userId?: string | null;
  isOwn?: boolean;
}

export interface PrefilterHit {
  id: string;
  weight: number;
  detail?: string;
}

export interface PrefilterResult {
  score: number; // 0..1
  hits: PrefilterHit[];
  /** true = already above threshold, no model needed */
  decisive: boolean;
  /** true = clearly human / skip model */
  skipModel: boolean;
}

export interface DecisionResult {
  /** Final score after the prefilter blend; this is what the policy acts on. */
  score: number; // 0..1
  /**
   * Decision-model score before the prefilter blend (0..1). Only present when
   * the model actually answered; prefilter-only and model-error results have
   * no model number to show.
   */
  modelScore?: number;
  reason: string;
  source: 'prefilter' | 'model' | 'cache' | 'skipped';
  /**
   * Which evidence actually produced `score`. Survives the cache rewrite of
   * `source`, so automatic (destructive) actions can require model evidence.
   */
  evidence?: 'model' | 'prefilter';
  prefilter?: PrefilterResult;
  raw?: unknown;
}

export interface ScoreRequest {
  post: PostExtract;
  settings: Settings;
}

export interface ProxyDecisionBody {
  protocol: ProtocolType;
  upstreamBaseUrl: string;
  upstreamPath: string;
  model: string;
  /** opaque payload already shaped by adapter */
  payload: unknown;
}
