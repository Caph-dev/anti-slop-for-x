/**
 * Background side of a recognition request.
 *
 * The content script sends the evidence snapshot, its request fingerprint and
 * local-only admission metadata. The key is read here and never sent back.
 */
import { resolveEndpoint } from './endpoints';
import { parseRecognitionInput, recognitionContext, type Recognition } from './recognition';
import { recognizeUpstream } from './recognizer-client';
import { requestFingerprint, transportExclusion, type RecognizeReply, type TransportSubject } from './scorer';
import { normalizeHandle } from './account-rules';
import { shouldScan } from './scan-state';
import { originPattern } from './permissions';
import type { Settings } from './types';

export function isRecognitionSender(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !Number.isInteger(sender.tab?.id)) return false;
  try {
    const url = new URL(sender.url ?? sender.tab?.url ?? '');
    return url.protocol === 'https:' && (url.hostname === 'x.com' || url.hostname === 'twitter.com');
  } catch {
    return false;
  }
}

export interface RecognitionServiceDeps {
  loadSettings: () => Promise<Settings>;
  fetcher?: typeof fetch;
  /** Host access for the endpoint origin; absent means "assume granted". */
  hasOriginAccess?: (pattern: string) => Promise<boolean>;
}

function parseSubject(value: unknown): TransportSubject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const subject = value as Record<string, unknown>;
  const handle = typeof subject.handle === 'string' ? normalizeHandle(subject.handle) : null;
  if (!handle || (subject.isOwn !== null && typeof subject.isOwn !== 'boolean') ||
    typeof subject.replyScoped !== 'boolean' || typeof subject.automatic !== 'boolean') return null;
  return { handle, isOwn: subject.isOwn, replyScoped: subject.replyScoped, automatic: subject.automatic };
}

function eligible(settings: Settings, fingerprint: string, subject: TransportSubject): boolean {
  return settings.enabled && requestFingerprint(settings) === fingerprint &&
    (!subject.automatic || shouldScan(settings, false)) &&
    (settings.scanScope !== 'replies-only' || subject.replyScoped);
}

export async function serveRecognition(message: unknown, deps: RecognitionServiceDeps): Promise<RecognizeReply> {
  const body = message as { input?: unknown; fingerprint?: unknown; subject?: unknown } | null;
  const input = parseRecognitionInput(body?.input);
  const subject = parseSubject(body?.subject);
  if (!input || !subject || typeof body?.fingerprint !== 'string') return { ok: false, reason: 'invalid_request' };

  const settings = await deps.loadSettings();
  if (!eligible(settings, body.fingerprint, subject)) return { ok: false, reason: 'stale' };
  const excluded = transportExclusion(input, settings, subject);
  if (excluded) return { ok: true, result: excluded };

  const endpoint = resolveEndpoint(settings);
  const pattern = originPattern(endpoint.baseUrl);
  if (deps.hasOriginAccess && pattern && !(await deps.hasOriginAccess(pattern).catch(() => false))) {
    const result: Recognition = { status: 'unavailable', reason: 'permission', context: recognitionContext(input) };
    return { ok: true, result };
  }

  const latest = await deps.loadSettings();
  if (!eligible(latest, body.fingerprint, subject) || latest.apiKey !== settings.apiKey) {
    return { ok: false, reason: 'stale' };
  }
  const latestExclusion = transportExclusion(input, latest, subject);
  if (latestExclusion) return { ok: true, result: latestExclusion };

  const started = performance.now();
  let attempted = false;
  const fetcher: typeof fetch = (...args) => {
    attempted = true;
    return (deps.fetcher ?? fetch)(...args);
  };
  const result = await recognizeUpstream(input, {
    protocol: endpoint.protocol,
    baseUrl: endpoint.baseUrl,
    path: endpoint.path,
    model: endpoint.model,
    apiKey: latest.apiKey,
    modelUse: !latest.prefilterOnly,
  }, fetcher);
  return attempted
    ? { ok: true, result, transport: { id: crypto.randomUUID(), latencyMs: Math.max(0, Math.round(performance.now() - started)) } }
    : { ok: true, result };
}
