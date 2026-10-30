import { runPrefilter } from './prefilter';
import { decideViaWorker, ProxyError } from './proxy-client';
import { scoreFromUpstream } from './adapters';
import { getCached, setCached } from './cache';
import type { DecisionResult, PostExtract, Settings } from './types';

/** Prefer background SW (host_permissions) over content-script fetch (page CORS). */
async function callModel(post: PostExtract, settings: Settings): Promise<unknown> {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const resp = await chrome.runtime.sendMessage({
        type: 'SLOP_SHIELD_DECIDE',
        post,
        settings,
      });
      if (resp?.ok) return resp.raw;
      throw new ProxyError(resp?.error || 'Background decide failed', resp?.status ?? 0, resp?.detail || '');
    }
  } catch (e) {
    if (e instanceof ProxyError) throw e;
    // fall through to direct (Node tests / non-extension)
  }
  return decideViaWorker(post, settings);
}

export async function scorePost(
  post: PostExtract,
  settings: Settings,
): Promise<DecisionResult> {
  const cached = getCached(post.id);
  if (cached) return { ...cached, source: 'cache' };

  const handle = (post.handle || '').replace(/^@/, '').toLowerCase();
  if (settings.accountWhitelist.some((h) => h.replace(/^@/, '').toLowerCase() === handle)) {
    const r: DecisionResult = {
      score: 0,
      reason: 'whitelist',
      source: 'skipped',
    };
    setCached(post.id, r);
    return r;
  }

  if (settings.skipOwnPosts && post.isOwn) {
    const r: DecisionResult = { score: 0, reason: 'own-post', source: 'skipped' };
    setCached(post.id, r);
    return r;
  }

  if (settings.skipShortText && (post.text?.trim().length ?? 0) < settings.shortTextMaxChars) {
    const r: DecisionResult = { score: 0, reason: 'short-text', source: 'skipped' };
    setCached(post.id, r);
    return r;
  }

  const pre = runPrefilter(post);

  if (settings.prefilterOnly || pre.decisive || pre.skipModel) {
    const r: DecisionResult = {
      score: pre.score,
      reason: pre.hits.map((h) => h.id).join(',') || (pre.skipModel ? 'human-like' : 'prefilter'),
      source: 'prefilter',
      prefilter: pre,
    };
    setCached(post.id, r);
    return r;
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
      prefilter: pre,
      raw,
    };
    setCached(post.id, r);
    return r;
  } catch (err) {
    // Fall back to prefilter on model failure
    const r: DecisionResult = {
      score: pre.score,
      reason: `model-error→prefilter:${pre.hits.map((h) => h.id).join(',') || 'none'}`,
      source: 'prefilter',
      prefilter: pre,
    };
    setCached(post.id, r);
    return r;
  }
}
