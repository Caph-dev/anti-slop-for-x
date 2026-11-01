/**
 * Cache and identity guards, exercised through the real interfaces.
 *
 * The point of `requestFingerprint` / `recognitionIdentity` is that a result
 * computed for one request can never be served, cached or mounted for another.
 * `scan-state.test.ts` covers the generation counter with plain objects; this
 * file uses `createRecognizer`, `recognitionIdentity`, `admission` and
 * `configProblem` themselves, and no numerical score.
 */
import { describe, expect, it } from 'vitest';
import {
  admission,
  configProblem,
  createRecognizer,
  recognitionIdentity,
  requestFingerprint,
  type RecognizeReply,
} from '../lib/scorer';
import { recognitionContext, type Recognition, type RecognitionInput } from '../lib/recognition';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

const INPUT: RecognitionInput = {
  sources: {
    post: { state: 'available', text: 'Solid writeup with real specifics' },
    parent: { state: 'missing' },
    root: { state: 'missing' },
    quote: { state: 'not-applicable' },
  },
  required: ['post'],
};

const CONTEXT = recognitionContext(INPUT);

const CLASSIFIED: Recognition = {
  status: 'classified',
  category: 'engagement_bait',
  reason: 'A reply is demanded before the content is shared.',
  evidence: [{ source: 'post', quote: 'Solid writeup' }],
  counterevidence: [],
  context: CONTEXT,
};

const MODEL_ABSTAINED: Recognition = {
  status: 'abstained',
  cause: 'model',
  reason: 'Ambiguous.',
  evidence: [],
  counterevidence: [],
  context: CONTEXT,
};

const NOT_CACHEABLE: Recognition[] = [
  { status: 'failed', error: 'rate_limited', context: CONTEXT },
  { status: 'abstained', cause: 'missing_context', missing: ['root'], context: CONTEXT },
  { status: 'unavailable', reason: 'missing_key', context: CONTEXT },
  { status: 'unavailable', reason: 'user_opted_out', context: CONTEXT },
];

/** Lets the transport be started (implementations may defer it) before we release it. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A usable Responses configuration: nothing is admitted locally for it. */
function settings(partial: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    endpointPreset: 'openai-responses',
    protocol: 'openai-responses',
    model: 'test-model',
    apiKey: 'test-key',
    skipShortText: false,
    prefilterOnly: false,
    ...partial,
  };
}

describe('request identity', () => {
  it('is stable for the same request and changes whenever the request would', () => {
    const base = settings();
    const identity = recognitionIdentity(INPUT, requestFingerprint(base));
    expect(recognitionIdentity(INPUT, requestFingerprint(settings()))).toBe(identity);

    const edits: Partial<Settings>[] = [
      { model: 'other-model' },
      { apiKey: 'rotated-key', credentialRevision: 1 },
      {
        endpointPreset: 'custom',
        upstreamBaseUrl: 'https://gateway.example.com/v1',
        upstreamPath: '/responses',
        model: 'test-model',
      },
    ];
    for (const edit of edits) {
      expect(recognitionIdentity(INPUT, requestFingerprint(settings(edit)))).not.toBe(identity);
    }
  });

  it('changes when the proven context changes, not only the endpoint', () => {
    const fingerprint = requestFingerprint(settings());
    const otherText: RecognitionInput = {
      ...INPUT,
      sources: { ...INPUT.sources, post: { state: 'available', text: 'Solid writeup with other specifics' } },
    };
    const partialPost: RecognitionInput = {
      ...INPUT,
      sources: { ...INPUT.sources, post: { state: 'partial', text: 'Solid writeup', gaps: ['truncated'] } },
    };

    const identity = recognitionIdentity(INPUT, fingerprint);
    expect(recognitionIdentity(otherText, fingerprint)).not.toBe(identity);
    expect(recognitionIdentity(partialPost, fingerprint)).not.toBe(identity);
    // Ordering of gaps is not a different request.
    expect(
      recognitionIdentity(
        { ...INPUT, sources: { ...INPUT.sources, post: { state: 'partial', text: 'Solid writeup', gaps: ['media', 'truncated'] } } },
        fingerprint,
      ),
    ).toBe(
      recognitionIdentity(
        { ...INPUT, sources: { ...INPUT.sources, post: { state: 'partial', text: 'Solid writeup', gaps: ['truncated', 'media'] } } },
        fingerprint,
      ),
    );
  });
});

describe('recognition cache', () => {
  it('never serves a stored result under a different request identity', () => {
    const recognizer = createRecognizer();
    const before = recognitionIdentity(INPUT, requestFingerprint(settings()));
    recognizer.store(before, CLASSIFIED);
    expect(recognizer.get(before)).toBe(CLASSIFIED);

    for (const edit of [
      { model: 'other-model' },
      { apiKey: 'rotated-key', credentialRevision: 1 },
      { endpointPreset: 'custom' as const, upstreamBaseUrl: 'https://gateway.example.com/v1' },
    ]) {
      const after = recognitionIdentity(INPUT, requestFingerprint(settings(edit)));
      expect(recognizer.get(after)).toBeUndefined();
    }
  });

  it('stores judgments only, never failures or local no-send states', () => {
    const recognizer = createRecognizer();
    const identity = recognitionIdentity(INPUT, requestFingerprint(settings()));

    for (const result of NOT_CACHEABLE) {
      recognizer.store(identity, result);
      expect(recognizer.get(identity)).toBeUndefined();
      expect(recognizer.size).toBe(0);
    }

    recognizer.store(identity, MODEL_ABSTAINED);
    expect(recognizer.get(identity)).toBe(MODEL_ABSTAINED);

    recognizer.store(identity, CLASSIFIED);
    expect(recognizer.get(identity)).toBe(CLASSIFIED);
    expect(recognizer.size).toBe(1);
  });

  it('keeps the cache per page instance', () => {
    const identity = recognitionIdentity(INPUT, requestFingerprint(settings()));
    const first = createRecognizer();
    first.store(identity, CLASSIFIED);

    // Nothing is persisted: a new content-script instance starts empty.
    expect(createRecognizer().get(identity)).toBeUndefined();
    first.clear();
    expect(first.get(identity)).toBeUndefined();
  });
});

describe('in-flight recognition', () => {
  it('shares one transport per identity and never caches its answer', async () => {
    const recognizer = createRecognizer();
    const identity = recognitionIdentity(INPUT, requestFingerprint(settings()));
    let calls = 0;
    let release!: (value: RecognizeReply) => void;
    const gate = new Promise<RecognizeReply>((resolve) => {
      release = resolve;
    });
    const send = () => {
      calls++;
      return gate;
    };

    const first = recognizer.run(identity, send);
    const second = recognizer.run(identity, send);
    expect(second).toBe(first);

    await tick();
    expect(calls).toBe(1);
    // A second caller this early must not open a second transport either.
    expect(recognizer.run(identity, send)).toBe(first);
    expect(calls).toBe(1);

    const reply: RecognizeReply = { ok: true, result: CLASSIFIED };
    release(reply);
    await expect(first).resolves.toEqual(reply);
    // Transport alone is not a cache write; only a current, valid judgment is.
    expect(recognizer.get(identity)).toBeUndefined();
  });

  it('does not reuse an invalidated request or let its completion clear the replacement', async () => {
    const recognizer = createRecognizer();
    let releaseOld!: (value: RecognizeReply) => void;
    let releaseNew!: (value: RecognizeReply) => void;
    const old = recognizer.run('same-identity', () => new Promise((resolve) => { releaseOld = resolve; }));
    await tick();
    recognizer.invalidatePending();
    const current = recognizer.run('same-identity', () => new Promise((resolve) => { releaseNew = resolve; }));
    await tick();
    expect(current).not.toBe(old);
    releaseOld({ ok: true, result: CLASSIFIED });
    await old;
    expect(recognizer.run('same-identity', () => Promise.resolve({ ok: false, reason: 'stale' }))).toBe(current);
    releaseNew({ ok: true, result: CLASSIFIED });
    await current;
  });

  it('frees the identity for a later attempt once the transport settles', async () => {
    const recognizer = createRecognizer();
    const identity = recognitionIdentity(INPUT, requestFingerprint(settings()));
    const send = () => Promise.resolve<RecognizeReply>({ ok: false, reason: 'stale' });

    expect(await recognizer.run(identity, send)).toEqual({ ok: false, reason: 'stale' });
    expect(await recognizer.run(identity, send)).toEqual({ ok: false, reason: 'stale' });
  });

  it('drops an answer that arrives under a settings generation that is gone', async () => {
    const recognizer = createRecognizer();
    const before = settings();
    const staleIdentity = recognitionIdentity(INPUT, requestFingerprint(before));
    let release!: (value: RecognizeReply) => void;
    const pending = recognizer.run(
      staleIdentity,
      () => new Promise<RecognizeReply>((resolve) => {
        release = resolve;
      }),
    );
    await tick();

    // The user changes the model while the request is out.
    const currentIdentity = recognitionIdentity(INPUT, requestFingerprint(settings({ model: 'other-model' })));
    expect(currentIdentity).not.toBe(staleIdentity);

    release({ ok: true, result: CLASSIFIED });
    await pending;

    // Even if the late answer were stored under its old identity, nothing looks it up.
    recognizer.store(staleIdentity, CLASSIFIED);
    expect(recognizer.get(currentIdentity)).toBeUndefined();
  });
});

describe('admission decides before any network', () => {
  it('reports the configuration problem instead of sending', () => {
    expect(configProblem(settings())).toBeNull();
    expect(configProblem(settings({ prefilterOnly: true }))).toBe('user_opted_out');
    expect(configProblem(settings({ endpointPreset: 'jev-official', protocol: 'jev' }))).toBe('unsupported_protocol');
    expect(configProblem(settings({ apiKey: '   ' }))).toBe('missing_key');
    expect(configProblem(settings({ model: ' ' }))).toBe('missing_model');
    expect(configProblem(settings({
      endpointPreset: 'custom',
      upstreamBaseUrl: 'http://example.com/v1',
      upstreamPath: '/responses',
    }))).toBe('invalid_config');
  });

  it('keeps model use off as an explicit no-send state, including manual scans', () => {
    const result = admission({ isOwn: false, input: INPUT }, settings({ prefilterOnly: true }), 'none');
    expect(result).toMatchObject({ status: 'unavailable', reason: 'user_opted_out' });
    expect(result?.context).toEqual(CONTEXT);
  });

  it('keeps the short-text preference and own posts local', () => {
    const short = admission(
      { isOwn: false, input: INPUT },
      settings({ skipShortText: true, shortTextMaxChars: 120 }),
      'none',
    );
    expect(short).toMatchObject({ status: 'unavailable', reason: 'short_text_preference' });

    // Long enough to be sent when the preference is on.
    expect(admission(
      { isOwn: false, input: INPUT },
      settings({ skipShortText: true, shortTextMaxChars: 12 }),
      'none',
    )).toBeNull();

    expect(admission({ isOwn: true, input: INPUT }, settings(), 'none'))
      .toMatchObject({ status: 'unavailable', reason: 'own_post_preference' });
    expect(admission({ isOwn: true, input: INPUT }, settings({ skipOwnPosts: false }), 'none')).toBeNull();
  });

  it('honours keep and hide rules and a disabled extension without sending', () => {
    expect(admission({ isOwn: false, input: INPUT }, settings(), 'keep'))
      .toMatchObject({ status: 'unavailable', reason: 'keep_rule' });
    expect(admission({ isOwn: false, input: INPUT }, settings(), 'hide'))
      .toMatchObject({ status: 'unavailable', reason: 'hide_rule' });
    expect(admission({ isOwn: false, input: INPUT }, settings({ enabled: false }), 'none'))
      .toMatchObject({ status: 'unavailable', reason: 'disabled' });
  });

  it('abstains when the proven context is not enough to judge', () => {
    const partial: RecognitionInput = {
      ...INPUT,
      sources: { ...INPUT.sources, post: { state: 'partial', text: 'Solid writeup', gaps: ['media'] } },
    };
    expect(admission({ isOwn: false, input: partial }, settings(), 'none'))
      .toMatchObject({ status: 'abstained', cause: 'missing_context', missing: ['post'] });

    const required: RecognitionInput = { ...INPUT, required: ['post', 'root'] };
    expect(admission({ isOwn: false, input: required }, settings(), 'none'))
      .toMatchObject({ status: 'abstained', cause: 'missing_context', missing: ['root'] });
  });
});
