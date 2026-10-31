import { runPrefilter } from './prefilter';
import { decideUpstream, UpstreamError } from './upstream-client';
import { scoreFromUpstream } from './adapters';
import { getCached, setCached } from './cache';
import type { DecisionResult, PostExtract, Settings } from './types';

/** Prefer background SW (host_permissions) over content-script fetch (page CORS). */
async function callModel(post: PostExtract, settings: Settings): Promise<unknown> {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const resp = await chrome.runtime.sendMessage({
        type: 'ANTI_SLOP_DECIDE',
        post,
        settings,
      });
      if (resp?.ok) return resp.raw;
      throw new UpstreamError(resp?.error || 'Background decide failed', resp?.status ?? 0, resp?.detail || '');
    }
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    // fall through to direct (Node tests / non-extension)
  }
  return decideUpstream(post, settings);
}

export interface ScoreOptions {
  /**
   * Cache slot to use instead of the post id. Debug mode passes its own
   * namespace so its scores cannot be read back by the normal fold path.
   */
  cacheKey?: string;
  /**
   * Return false to skip the cache write: the score is about to be discarded
   * because the settings changed while the request was in flight, and a stale
   * number must not become the next scan's starting point.
   */
  shouldCache?: () => boolean;
}

export async function scorePost(
  post: PostExtract,
  settings: Settings,
  options: ScoreOptions = {},
): Promise<DecisionResult> {
  const key = options.cacheKey ?? post.id;
  const store = (result: DecisionResult): DecisionResult => {
    if (options.shouldCache?.() !== false) setCached(key, result);
    return result;
  };
  const cached = getCached(key);
  if (cached) return { ...cached, source: 'cache' };

  const handle = (post.handle || '').replace(/^@/, '').toLowerCase();
  if (settings.accountWhitelist.some((h) => h.replace(/^@/, '').toLowerCase() === handle)) {
    const r: DecisionResult = {
      score: 0,
      reason: 'whitelist',
      source: 'skipped',
    };
    return store(r);
  }

  if (settings.skipOwnPosts && post.isOwn) {
    const r: DecisionResult = { score: 0, reason: 'own-post', source: 'skipped' };
    return store(r);
  }

  if (settings.skipShortText && (post.text?.trim().length ?? 0) < settings.shortTextMaxChars) {
    const r: DecisionResult = { score: 0, reason: 'short-text', source: 'skipped' };
    return store(r);
  }

  const pre = runPrefilter(post);

  if (settings.prefilterOnly || pre.decisive || pre.skipModel) {
    const r: DecisionResult = {
      score: pre.score,
      reason: pre.hits.map((h) => h.id).join(',') || (pre.skipModel ? 'human-like' : 'prefilter'),
      source: 'prefilter',
      evidence: 'prefilter',
      prefilter: pre,
    };
    return store(r);
  }

  // Borderline → model
  try {
    const raw = await callModel(post, settings);
    const { score, reason } = scoreFromUpstream(settings.protocol, raw);
    // Blend lightly with prefilter
    const blended = Math.max(score, pre.score * 0.85);
    const r: DecisionResult = {
      score: blended,
      reason: `model:${reason}; pre=${pre.score.toFixed(2)}`,
      source: 'model',
      evidence: 'model',
      prefilter: pre,
      raw,
    };
    return store(r);
  } catch (err) {
    // Fall back to prefilter on model failure
    const r: DecisionResult = {
      score: pre.score,
      reason: `model-error→prefilter:${pre.hits.map((h) => h.id).join(',') || 'none'}`,
      source: 'prefilter',
      evidence: 'prefilter',
      prefilter: pre,
    };
    return store(r);
  }
}
