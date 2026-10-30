/** Shared types for slop-shield */

export type ProtocolType = 'jev' | 'openai-decisions';

export type ScanScope = 'replies-only' | 'timeline-and-replies';

export interface Settings {
  enabled: boolean;
  autoScan: boolean;
  scanScope: ScanScope;
  threshold: number; // 0..1, fold when score >= threshold
  skipShortText: boolean;
  shortTextMaxChars: number;
  skipOwnPosts: boolean;
  prefilterOnly: boolean; // skip model
  workerBaseUrl: string;
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
  threshold: 0.55,
  skipShortText: true,
  shortTextMaxChars: 12,
  skipOwnPosts: true,
  prefilterOnly: false,
  workerBaseUrl: 'http://127.0.0.1:8787',
  upstreamBaseUrl: 'https://ai.caph.me/v1',
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
