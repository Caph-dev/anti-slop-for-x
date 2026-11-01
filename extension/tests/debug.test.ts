/**
 * Debug mode shows the recognition state of a post: a category, an abstention,
 * no-send reason or failure code. There is no score, so these tests pin the
 * observable contract instead: every status maps to a named, translated label,
 * failures stay visible as problems, abstentions say what was missing, and no
 * label invents a number.
 */
import { describe, expect, it } from 'vitest';
import { contextDetail, diagnosticLabel, outcomeLabel } from '../lib/debug';
import { outcomeCode } from '../lib/diagnostics';
import {
  RECOGNITION_CATEGORIES,
  isTarget,
  recognitionContext,
  type ContextState,
  type Recognition,
  type RecognitionError,
  type RecognitionInput,
  type RecognitionUnavailableReason,
} from '../lib/recognition';
import { uiT } from '../lib/i18n-ui';

const t = uiT('en');

const CONTEXT: ContextState = {
  post: 'available',
  parent: 'available',
  root: 'missing',
  quote: 'not-applicable',
};

const INPUT: RecognitionInput = {
  sources: {
    post: { state: 'available', text: 'Reply YES for the link.' },
    parent: { state: 'available', text: 'The meeting is on Friday.' },
    root: { state: 'missing' },
    quote: { state: 'not-applicable' },
  },
  required: ['post'],
};

const DETAILS = {
  reason: 'A reply is demanded.',
  evidence: [{ source: 'post' as const, quote: 'Reply YES' }],
  counterevidence: [],
  context: CONTEXT,
};

const classified = (category: (typeof RECOGNITION_CATEGORIES)[number]): Recognition =>
  ({ status: 'classified', category, ...DETAILS });

const UNSPECIFIED_ERRORS: RecognitionError[] = [
  'timeout',
  'rate_limited',
  'authentication',
  'network',
  'http',
  'refusal',
  'incomplete',
  'invalid_json',
  'invalid_output',
  'invalid_provenance',
  'internal',
];

const NO_SEND_REASONS: RecognitionUnavailableReason[] = [
  'disabled',
  'user_opted_out',
  'short_text_preference',
  'own_post_preference',
  'own_identity_unknown',
  'keep_rule',
  'hide_rule',
  'unsupported_protocol',
  'missing_key',
  'missing_model',
  'invalid_config',
  'permission',
];

/** One result of every outcome the content script can reach. */
const ALL_OUTCOMES: Recognition[] = [
  ...RECOGNITION_CATEGORIES.map(classified),
  { status: 'abstained', cause: 'model', ...DETAILS },
  { status: 'abstained', cause: 'missing_context', missing: ['root'], context: CONTEXT },
  ...NO_SEND_REASONS.map((reason): Recognition => ({ status: 'unavailable', reason, context: CONTEXT })),
  ...UNSPECIFIED_ERRORS.map((error): Recognition => ({ status: 'failed', error, context: CONTEXT })),
];

describe('diagnostic categories', () => {
  it('shows the category for a target and a plain "Normal" for normal', () => {
    for (const category of ['engagement_bait', 'generic_irrelevant', 'content_free_restatement'] as const) {
      const result = classified(category);
      const label = diagnosticLabel(result, t);

      expect(label.level).toBe('target');
      expect(label.status).toBe('classified');
      expect(label.text).toBe(t(`dbg_${category}`));
      // A real translation, not a raw key that the table lacked.
      expect(label.text).not.toBe(`dbg_${category}`);
      expect(isTarget(result)).toBe(true);
    }

    const normal = classified('normal');
    expect(diagnosticLabel(normal, t)).toMatchObject({ level: 'normal', text: 'Normal', status: 'classified' });
    expect(isTarget(normal)).toBe(false);
  });

  it('never renders a number where the old score used to be', () => {
    for (const result of ALL_OUTCOMES) {
      const label = diagnosticLabel(result, t);
      expect(label.text).not.toMatch(/[\d%]/u);
      expect(label.detail).not.toMatch(/%/u);
    }
  });

  it('lists every source state as the hover detail, and the model caveat', () => {
    expect(contextDetail(CONTEXT, t)).toBe(
      'Post: available · Parent: available · Thread start: missing · Quoted post: none',
    );

    const qualified = diagnosticLabel(classified('engagement_bait'), t);
    expect(qualified.detail).toBe(`${contextDetail(CONTEXT, t)}\n${t('modelNote')}`);
  });
});

describe('diagnostic abstentions and failures', () => {
  it('names the missing or incomplete context instead of guessing', () => {
    const partial: ContextState = { ...CONTEXT, parent: 'partial', root: 'missing' };
    const label = diagnosticLabel(
      { status: 'abstained', cause: 'missing_context', missing: ['parent', 'root'], context: partial },
      t,
    );

    expect(label.level).toBe('neutral');
    expect(label.status).toBe('abstained');
    expect(label.text).toBe('Abstained · Parent incomplete, Thread start missing');
    expect(label.detail).toBe(contextDetail(partial, t));
  });

  it('tells a model abstention apart from missing context', () => {
    const label = diagnosticLabel({ status: 'abstained', cause: 'model', ...DETAILS }, t);
    expect(label).toMatchObject({ level: 'neutral', text: 'Abstained · model unsure', status: 'abstained' });
    expect(label.text).not.toContain('missing');
  });

  it('shows why nothing was sent for every no-send reason', () => {
    for (const reason of NO_SEND_REASONS) {
      const result: Recognition = { status: 'unavailable', reason, context: CONTEXT };
      const label = diagnosticLabel(result, t);

      expect(label.level).toBe('neutral');
      expect(label.status).toBe('unavailable');
      expect(label.text).toBe(`Not sent · ${t(`r_${reason}`)}`);
      // Translated, not the raw r_* key.
      expect(label.text).not.toContain('r_');
      expect(t(`r_${reason}`)).not.toBe(`r_${reason}`);
      expect(isTarget(result)).toBe(false);
    }
  });

  it('shows a failure as a problem, never as a target', () => {
    for (const error of UNSPECIFIED_ERRORS) {
      const result: Recognition = { status: 'failed', error, context: CONTEXT };
      const label = diagnosticLabel(result, t);

      expect(label.level).toBe('problem');
      expect(label.status).toBe('failed');
      expect(label.text).toBe(`Failed · ${t(`e_${error}`)}`);
      expect(label.text).not.toContain('e_');
      expect(t(`e_${error}`)).not.toBe(`e_${error}`);
      expect(isTarget(result)).toBe(false);
    }
  });

  it('keeps the failure visible even when its only meaning is "try again later"', () => {
    expect(diagnosticLabel({ status: 'failed', error: 'network', context: CONTEXT }, t).text).toBe('Failed · network error');
    expect(diagnosticLabel({ status: 'failed', error: 'timeout', context: CONTEXT }, t).text).toBe('Failed · timed out');
  });
});

describe('popup outcome codes', () => {
  it('uses the same wording as the badge for every outcome', () => {
    for (const result of ALL_OUTCOMES) {
      const label = diagnosticLabel(result, t);
      const outcome = outcomeLabel(result.status, outcomeCode(result), t);
      if (result.status === 'abstained' && result.cause === 'missing_context') {
        // The badge lists the sources; the popup only has the code.
        expect(outcome).toBe(`Abstained · ${t('missingContext')}`);
      } else {
        expect(outcome).toBe(label.text);
      }
    }
  });

  it('keeps unknown codes out of the shipped labels', () => {
    // A code without a translation must not silently become a category.
    expect(outcomeLabel('classified', 'normal', t)).toBe('Normal');
    expect(outcomeLabel('failed', 'invalid_provenance', t)).toBe('Failed · quote not found in source');
    expect(outcomeLabel('unavailable', 'permission', t)).toBe('Not sent · no host access');
  });

  it('reads codes from the input the way the content script produces them', () => {
    const context = recognitionContext(INPUT);
    expect(outcomeLabel('classified', outcomeCode({ status: 'classified', category: 'engagement_bait', ...DETAILS, context }), t))
      .toBe('Engagement bait');
    expect(outcomeLabel('unavailable', outcomeCode({ status: 'unavailable', reason: 'missing_key', context }), t))
      .toBe('Not sent · no API key');
  });
});
