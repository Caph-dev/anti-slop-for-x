/**
 * Content-script scheduling, through the real entrypoint.
 *
 * Only the page boundary is faked: one article, the recognition snapshot read
 * from it, and the background transport. Admission, the page cache, request
 * identity, scan-state generations, the presentation policy and the diagnostics
 * record are the production modules. What is asserted is observable behaviour:
 * nothing is sent or mounted when it must not be, and a stale answer is neither
 * mounted nor cached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';
import {
  recognitionContext,
  type Recognition,
  type RecognitionInput,
} from '../lib/recognition';

const mocks = vi.hoisted(() => ({
  sendRecognition: vi.fn(),
  mountCard: vi.fn(),
  mountDiagnostic: vi.fn(),
  clearMounted: vi.fn(),
  muteUser: vi.fn(),
  blockUser: vi.fn(),
  unobserve: vi.fn(),
  article: null as unknown,
}));

vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (value: unknown) => value }));
vi.mock('../lib/scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/scorer')>();
  return { ...actual, sendRecognition: mocks.sendRecognition };
});
vi.mock('../lib/ui', () => ({
  alreadyMounted: () => false,
  announce: () => {},
  clearMounted: mocks.clearMounted,
  mountCard: mocks.mountCard,
  mountDiagnostic: mocks.mountDiagnostic,
}));
vi.mock('../lib/x/mute-block', () => ({
  muteUser: mocks.muteUser,
  blockUser: mocks.blockUser,
  unblockUser: vi.fn(),
}));
vi.mock('../lib/x/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/x/dom')>();
  return {
    ...actual,
    listArticles: () => (mocks.article ? [mocks.article] : []),
    readSnapshot: () => live,
    postIdOf: () => SNAPSHOT.post.id,
    currentUserHandle: () => null,
  };
});

const INPUT: RecognitionInput = {
  sources: {
    post: { state: 'available', text: 'A post with enough text to recognize' },
    parent: { state: 'missing' },
    root: { state: 'missing' },
    quote: { state: 'not-applicable' },
  },
  required: ['post'],
};

const SNAPSHOT = {
  post: { id: '123', handle: 'author', isReply: true, isOwn: false },
  input: INPUT,
};

/** What the page proves right now; a test can change it mid-request. */
let live = SNAPSHOT;

function setPostText(text: string): void {
  live = {
    ...SNAPSHOT,
    input: { ...INPUT, sources: { ...INPUT.sources, post: { state: 'available', text } } },
  };
}

const CLASSIFIED: Recognition = {
  status: 'classified',
  category: 'engagement_bait',
  reason: 'A reply is demanded.',
  evidence: [{ source: 'post', quote: 'A post with enough text' }],
  counterevidence: [],
  context: recognitionContext(INPUT),
};

const NETWORK_FAILURE: Recognition = { status: 'failed', error: 'network', context: recognitionContext(INPUT) };

/** A configuration that can actually send, so admission is the only gate left. */
const SENDABLE: Partial<Settings> = {
  enabled: true,
  autoScan: false,
  scanMode: 'manual',
  endpointPreset: 'openai-responses',
  protocol: 'openai-responses',
  model: 'test-model',
  apiKey: 'test-key',
  debugMode: false,
  skipShortText: false,
  prefilterOnly: false,
};

interface DiagnosticsReply {
  ok: boolean;
  diagnostics: {
    total: number;
    outcomes: Record<string, number>;
    counterfactualFolds: number;
    presented: Record<string, number>;
  };
  pause: string | null;
}

type MessageListener = (
  message: { type: string },
  sender: unknown,
  respond: (value: unknown) => void,
) => boolean;
type StorageListener = (changes: Record<string, unknown>, area: string) => void;

class Article {
  isConnected = true;
  getBoundingClientRect() {
    return { top: 10, bottom: 100 };
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function boot(initial: Partial<Settings>) {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...SENDABLE, ...initial };
  let delayedRead: { gate: Promise<void>; started: () => void } | null = null;
  let messageListener!: MessageListener;
  let storageListener!: StorageListener;
  const intersections: Array<(entries: Array<{ isIntersecting: boolean; target: Article }>) => void> = [];
  const observe = vi.fn();
  const interval = vi.fn();
  mocks.article = new Article();
  live = SNAPSHOT;

  vi.stubGlobal('HTMLElement', Article);
  vi.stubGlobal('window', { innerHeight: 800 });
  vi.stubGlobal('navigator', { language: 'en' });
  vi.stubGlobal('location', { pathname: '/' });
  vi.stubGlobal('document', {
    body: {},
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, remove() {} }),
  });
  vi.stubGlobal('MutationObserver', class {
    observe() {}
  });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean; target: Article }>) => void) {
      intersections.push(callback);
    }
    observe = observe;
    unobserve = mocks.unobserve;
  });
  vi.stubGlobal('setInterval', interval);
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: async () => {
        const snapshot = { ...settings };
        const pending = delayedRead;
        delayedRead = null;
        if (pending) { pending.started(); await pending.gate; }
        return { antiSlopForXSettings: snapshot };
      } },
      onChanged: { addListener: (listener: StorageListener) => { storageListener = listener; } },
    },
    runtime: {
      onMessage: { addListener: (listener: MessageListener) => { messageListener = listener; } },
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
  });

  const entrypoint = (await import('../entrypoints/content')).default;
  entrypoint.main({} as NonNullable<Parameters<typeof entrypoint.main>[0]>);
  await vi.waitFor(() => expect(observe).toHaveBeenCalled());
  expect(observe.mock.calls[0][0]).toBe(mocks.article);

  return {
    /** The viewport trigger observer (the second observer only tracks reading). */
    visible: () => intersections[0]([{ isIntersecting: true, target: mocks.article as Article }]),
    scanNow: () =>
      new Promise<unknown>((resolve) => {
        expect(messageListener({ type: 'ANTI_SLOP_SCAN_NOW' }, {}, resolve)).toBe(true);
      }),
    diagnostics: () =>
      new Promise<DiagnosticsReply>((resolve) => {
        messageListener({ type: 'ANTI_SLOP_DIAGNOSTICS' }, {}, resolve as (value: unknown) => void);
      }),
    update: (changes: Partial<Settings>) => {
      settings = { ...settings, ...changes };
      storageListener({ antiSlopForXSettings: {} }, 'local');
    },
    deferNextSettingsRead: () => {
      let release!: () => void;
      let notify!: () => void;
      const started = new Promise<void>((resolve) => { notify = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      delayedRead = { gate, started: notify };
      return { started, release };
    },
    /** Remove the article as X would when recycling the timeline. */
    detach: () => {
      const article = mocks.article as Article;
      article.isConnected = false;
      mocks.article = null;
      return article;
    },
    watch: () => (interval.mock.calls[0][0] as () => void)(),
    /** Pretend X rewrote the post in place while a request was out. */
    setPostText,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendRecognition.mockReset().mockResolvedValue({ ok: true, result: CLASSIFIED });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __antiSlopScan?: unknown }).__antiSlopScan;
});

describe('content script scan scheduling', () => {
  it('does not apply an older settings read after a newer model opt-out', async () => {
    const page = await boot({ prefilterOnly: true });
    const delayed = page.deferNextSettingsRead();
    page.update({ prefilterOnly: false });
    await delayed.started;
    page.update({ prefilterOnly: true });
    await flush();
    delayed.release();
    await flush();
    await page.scanNow();
    expect(mocks.sendRecognition).not.toHaveBeenCalled();
  });

  it('ignores visible observer events with auto scan off but still honours a manual scan', async () => {
    const page = await boot({});

    page.visible();
    await flush();
    expect(mocks.sendRecognition).not.toHaveBeenCalled();
    expect(mocks.mountCard).not.toHaveBeenCalled();

    expect(await page.scanNow()).toEqual({ ok: true, scanned: 1 });
    expect(mocks.sendRecognition).toHaveBeenCalledTimes(1);
    expect(mocks.mountCard).toHaveBeenCalledTimes(1);
    // The advisory card carries a category, never a number.
    expect(mocks.mountCard.mock.calls[0][1]).toMatchObject({
      presentation: 'advisory',
      kind: 'model',
      category: 'engagement_bait',
    });
  });

  it('unobserves removed article nodes on the next watch pass', async () => {
    const page = await boot({});
    const removed = page.detach();
    page.watch();
    expect(mocks.unobserve).toHaveBeenCalledTimes(2);
    expect(mocks.unobserve).toHaveBeenNthCalledWith(1, removed);
    expect(mocks.unobserve).toHaveBeenNthCalledWith(2, removed);
    page.watch();
    expect(mocks.unobserve).toHaveBeenCalledTimes(2);
  });

  it('does nothing while disabled, including a manual scan', async () => {
    const page = await boot({ enabled: false });

    page.visible();
    expect(await page.scanNow()).toEqual({ ok: true, scanned: 0 });
    await flush();
    expect(mocks.sendRecognition).not.toHaveBeenCalled();
    expect(mocks.mountCard).not.toHaveBeenCalled();
    expect(mocks.mountDiagnostic).not.toHaveBeenCalled();
    expect(mocks.muteUser).not.toHaveBeenCalled();
    expect(mocks.blockUser).not.toHaveBeenCalled();
  });

  it('never sends when model use is off, even for a manual scan', async () => {
    const page = await boot({ prefilterOnly: true });

    expect(await page.scanNow()).toEqual({ ok: true, scanned: 1 });
    expect(mocks.sendRecognition).not.toHaveBeenCalled();
    expect(mocks.mountCard).not.toHaveBeenCalled();
  });

  it('keeps a post local when the short-text preference covers it', async () => {
    const page = await boot({ skipShortText: true, shortTextMaxChars: 120 });

    expect(await page.scanNow()).toEqual({ ok: true, scanned: 1 });
    expect(mocks.sendRecognition).not.toHaveBeenCalled();
  });

  it('sends only once for the same post while the first request is in flight', async () => {
    let release!: (value: { ok: true; result: Recognition }) => void;
    mocks.sendRecognition.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    const page = await boot({});

    const first = page.scanNow();
    const second = page.scanNow();
    await vi.waitFor(() => expect(mocks.sendRecognition).toHaveBeenCalledTimes(1));

    release({ ok: true, result: CLASSIFIED });
    expect(await first).toEqual({ ok: true, scanned: 1 });
    expect(await second).toEqual({ ok: true, scanned: 0 });
    expect(mocks.sendRecognition).toHaveBeenCalledTimes(1);
    expect(mocks.mountCard).toHaveBeenCalledTimes(1);
  });

  it('lets a manual scan join and take ownership of an automatic request', async () => {
    let release!: (value: { ok: true; result: Recognition }) => void;
    mocks.sendRecognition.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const page = await boot({ autoScan: true });
    await vi.waitFor(() => expect(mocks.sendRecognition).toHaveBeenCalledTimes(1));
    const manual = page.scanNow();
    await flush();
    release({ ok: true, result: CLASSIFIED });
    expect(await manual).toEqual({ ok: true, scanned: 1 });
    expect(mocks.sendRecognition).toHaveBeenCalledTimes(1);
    expect(mocks.mountCard).toHaveBeenCalledTimes(1);
  });

  it('rejects mounting and caching when auto scan is turned off in flight', async () => {
    let release!: (value: { ok: true; result: Recognition }) => void;
    mocks.sendRecognition.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    const page = await boot({ autoScan: true });
    await vi.waitFor(() => expect(mocks.sendRecognition).toHaveBeenCalledTimes(1));

    page.update({ autoScan: false });
    await flush();
    release({ ok: true, result: CLASSIFIED });
    await flush();

    expect(mocks.mountCard).not.toHaveBeenCalled();
    expect(mocks.mountDiagnostic).not.toHaveBeenCalled();

    // The stale answer was not cached: a manual scan has to send again.
    mocks.sendRecognition.mockResolvedValue({ ok: true, result: CLASSIFIED });
    expect(await page.scanNow()).toEqual({ ok: true, scanned: 1 });
    expect(mocks.sendRecognition).toHaveBeenCalledTimes(2);
    expect(mocks.mountCard).toHaveBeenCalledTimes(1);
  });

  it('drops an in-flight result when the request endpoint changes', async () => {
    let release!: (value: { ok: true; result: Recognition }) => void;
    mocks.sendRecognition.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    const page = await boot({});
    const pending = page.scanNow();
    await vi.waitFor(() => expect(mocks.sendRecognition).toHaveBeenCalledTimes(1));

    // Another model means another request: nothing in flight may land or persist.
    page.update({ model: 'other-model' });
    await flush();
    release({ ok: true, result: CLASSIFIED });

    expect(await pending).toEqual({ ok: true, scanned: 0 });
    expect(mocks.mountCard).not.toHaveBeenCalled();

    mocks.sendRecognition.mockResolvedValue({ ok: true, result: CLASSIFIED });
    expect(await page.scanNow()).toEqual({ ok: true, scanned: 1 });
    expect(mocks.sendRecognition).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an in-flight request after the model changes away and back', async () => {
    const releases: Array<(value: { ok: true; result: Recognition }) => void> = [];
    mocks.sendRecognition.mockImplementation(() => new Promise((resolve) => { releases.push(resolve); }));
    const page = await boot({});
    const old = page.scanNow();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    page.update({ model: 'other-model' });
    await flush();
    page.update({ model: 'test-model' });
    await flush();
    const current = page.scanNow();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]({ ok: true, result: CLASSIFIED });
    expect(await old).toEqual({ ok: true, scanned: 0 });
    expect(mocks.mountCard).not.toHaveBeenCalled();
    releases[1]({ ok: true, result: CLASSIFIED });
    expect(await current).toEqual({ ok: true, scanned: 1 });
    expect(mocks.mountCard).toHaveBeenCalledTimes(1);
  });

  it('drops a result whose post text changed under the same id', async () => {
    let release!: (value: { ok: true; result: Recognition }) => void;
    mocks.sendRecognition.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    const page = await boot({});
    const pending = page.scanNow();
    await vi.waitFor(() => expect(mocks.sendRecognition).toHaveBeenCalledTimes(1));

    // Same post id, edited text: a different request, so its answer cannot be shown.
    page.setPostText('A different post text entirely');
    release({ ok: true, result: CLASSIFIED });

    expect(await pending).toEqual({ ok: true, scanned: 0 });
    expect(mocks.mountCard).not.toHaveBeenCalled();

    // The answer stays under its own identity; the edited post is sent again.
    mocks.sendRecognition.mockResolvedValue({ ok: true, result: CLASSIFIED });
    expect(await page.scanNow()).toEqual({ ok: true, scanned: 1 });
    expect(mocks.sendRecognition).toHaveBeenCalledTimes(2);
    expect(mocks.mountCard).toHaveBeenCalledTimes(1);
  });

  it('reuses a stored judgment for the same request instead of sending again', async () => {
    const page = await boot({});

    expect(await page.scanNow()).toEqual({ ok: true, scanned: 1 });
    expect(await page.scanNow()).toEqual({ ok: true, scanned: 1 });
    expect(mocks.sendRecognition).toHaveBeenCalledTimes(1);
  });

  it('shows an automatic failure as a diagnostic badge in debug mode, not as a card', async () => {
    mocks.sendRecognition.mockResolvedValue({ ok: true, result: NETWORK_FAILURE });
    await boot({ debugMode: true });

    await vi.waitFor(() => expect(mocks.mountDiagnostic).toHaveBeenCalledTimes(1));
    expect(mocks.sendRecognition).toHaveBeenCalledTimes(1);
    expect(mocks.mountCard).not.toHaveBeenCalled();
    expect(mocks.mountDiagnostic.mock.calls[0][1]).toMatchObject({ level: 'problem', status: 'failed' });
  });

  it('records the outcome and the counterfactual in shadow mode without touching the post', async () => {
    const page = await boot({ scanMode: 'shadow', autoScan: true });

    await vi.waitFor(async () => expect((await page.diagnostics()).diagnostics.total).toBe(1));
    const reply = await page.diagnostics();

    expect(reply.diagnostics.outcomes).toEqual({ 'classified:engagement_bait': 1 });
    // A fold-everything policy would have folded it. None was folded.
    expect(reply.diagnostics.counterfactualFolds).toBe(1);
    expect(reply.diagnostics.presented).toMatchObject({ none: 1, fold: 0 });
    expect(reply.pause).toBeNull();
    expect(mocks.mountCard).not.toHaveBeenCalled();
    expect(mocks.mountDiagnostic).not.toHaveBeenCalled();
    // And nothing acted on the author either.
    expect(mocks.muteUser).not.toHaveBeenCalled();
    expect(mocks.blockUser).not.toHaveBeenCalled();
    expect(mocks.clearMounted).not.toHaveBeenCalled();
  });

  it('records a failed request as its own outcome, and fails open', async () => {
    mocks.sendRecognition.mockResolvedValue({ ok: true, result: NETWORK_FAILURE });
    const page = await boot({ scanMode: 'shadow', autoScan: true });

    await vi.waitFor(async () => expect((await page.diagnostics()).diagnostics.total).toBe(1));
    expect((await page.diagnostics()).diagnostics.outcomes).toEqual({ 'failed:network': 1 });
    expect(mocks.mountCard).not.toHaveBeenCalled();
    expect(mocks.mountDiagnostic).not.toHaveBeenCalled();
  });

  it('records an internal background error without exposing details or changing posts', async () => {
    mocks.sendRecognition.mockResolvedValue({ ok: false, reason: 'internal' });
    const page = await boot({ scanMode: 'shadow', autoScan: true });
    await vi.waitFor(async () => expect((await page.diagnostics()).diagnostics.total).toBe(1));
    expect((await page.diagnostics()).diagnostics.outcomes).toEqual({ 'failed:internal': 1 });
    expect(mocks.mountCard).not.toHaveBeenCalled();
  });

  it('reports a stale reply by resyncing instead of rendering it', async () => {
    mocks.sendRecognition.mockResolvedValue({ ok: false, reason: 'stale' });
    const page = await boot({});
    const before = await page.diagnostics();

    expect(await page.scanNow()).toEqual({ ok: true, scanned: 0 });
    expect(mocks.mountCard).not.toHaveBeenCalled();
    expect(mocks.mountDiagnostic).not.toHaveBeenCalled();
    expect((await page.diagnostics()).diagnostics.total).toBe(before.diagnostics.total);
  });
});
