import type { PostExtract, Settings } from '../types';
import { buildJevPayload, scoreFromJev, type JevResponse } from './jev';
import {
  OPENAI_DECISIONS_DEFAULT_PATH,
  buildOpenAIDecisionsPayload,
  scoreFromOpenAIDecisions,
  type OpenAIDecisionsResponse,
} from './openai-decisions';

export { buildJevPayload, scoreFromJev } from './jev';
export {
  buildOpenAIDecisionsPayload,
  scoreFromOpenAIDecisions,
  OPENAI_DECISIONS_DEFAULT_PATH,
} from './openai-decisions';

export function resolveUpstreamPath(settings: Settings): string {
  if (settings.upstreamPath) return settings.upstreamPath;
  return settings.protocol === 'openai-decisions' ? OPENAI_DECISIONS_DEFAULT_PATH : '/systemone';
}

export function buildUpstreamPayload(post: PostExtract, settings: Settings): unknown {
  if (settings.protocol === 'openai-decisions') {
    return buildOpenAIDecisionsPayload(post, settings);
  }
  return buildJevPayload(post, settings);
}

export function scoreFromUpstream(
  protocol: Settings['protocol'],
  body: unknown,
): { score: number; reason: string } {
  if (protocol === 'openai-decisions') {
    return scoreFromOpenAIDecisions(body as OpenAIDecisionsResponse);
  }
  return scoreFromJev(body as JevResponse);
}
