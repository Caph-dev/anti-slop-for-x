/** Shared types for Anti Slop for X */

export type ProtocolType = 'jev' | 'openai-decisions';

/**
 * Which upstream the extension talks to. The two official presets carry their
 * own base URL / path / protocol / model; `custom` uses the user's fields.
 */
export type EndpointPreset = 'jev-official' | 'openai-official' | 'custom';

export type ScanScope = 'replies-only' | 'timeline-and-replies';

/**
 * What happens to a post once it is scored:
 * - `manual`    show the AI rate, the user decides
 * - `auto-fold` fold replies over the threshold (default)
 * - `strict`    fold, and auto-block the author above 90%
 */
export type ScanMode = 'manual' | 'auto-fold' | 'strict';

export interface Settings {
  enabled: boolean;
  autoScan: boolean;
  scanScope: ScanScope;
  scanMode: ScanMode;
  threshold: number; // 0..1, fold when score >= threshold
  skipShortText: boolean;
  shortTextMaxChars: number;
  skipOwnPosts: boolean;
  prefilterOnly: boolean; // skip model
  /** Built-in endpoint preset, or `custom` to use the fields below. */
  endpointPreset: EndpointPreset;
  /** User's own model endpoint (used when endpointPreset is `custom`). */
  upstreamBaseUrl: string;
  upstreamPath: string;
  apiKey: string;
  model: string;
  protocol: ProtocolType;
  defaultPrompt: string;
  accountWhitelist: string[]; // handles without @
  maxConcurrency: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  autoScan: true,
  scanScope: 'replies-only',
  scanMode: 'auto-fold',
  threshold: 0.55,
  skipShortText: true,
  shortTextMaxChars: 12,
  skipOwnPosts: true,
  prefilterOnly: false,
  endpointPreset: 'jev-official',
  upstreamBaseUrl: 'https://api.typesafe.ai/v1',
  upstreamPath: '/systemone',
  apiKey: '',
  model: 'jev-latest',
  protocol: 'jev',
  defaultPrompt: 'does this look like AI engagement bait / bot reply on X',
  accountWhitelist: [],
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
  score: number; // 0..1
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
