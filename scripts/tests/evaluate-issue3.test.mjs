import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { evaluate } from '../evaluate-issue3.mjs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const cliPath = fileURLToPath(new URL('../evaluate-issue3.mjs', import.meta.url));
const digest = (s) => createHash('sha256').update(s).digest('hex');
function cli(samples, predictions, m, malformed = false, entry = cliPath) {
  const directory = mkdtempSync(join(tmpdir(), 'issue3-cli-'));
  try {
    const inputs = [JSON.stringify(samples), JSON.stringify(predictions), JSON.stringify(m)];
    if (malformed) inputs[0] = '{';
    const paths = inputs.map((input, i) => {
      const path = join(directory, `${i}.json`);
      writeFileSync(path, input);
      return path;
    });
    return spawnSync(process.execPath, [entry, ...paths], { encoding: 'utf8', timeout: 10000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

const hashes = { datasetSha256: 'a'.repeat(64), predictionsSha256: 'b'.repeat(64) };
const config = { modelId: 'model', promptId: 'prompt', schemaId: 'schema', policyId: 'policy' };
const manifest = { ...hashes, targetCategories: ['spam', 'promo', 'repetition'], strategyConfigs: { s: config }, sourcePermission: 'authorized', humanAnnotation: 'reviewed', splitMetadata: 'isolated-chronological', statisticalPlanId: 'plan', bootstrapSeed: 42, bootstrapIterations: 500, strategyIds: ['s'], candidateStrategyId: 's', requiredPopulations: [{ cohort: 'natural', language: 'en', categories: ['spam'] }], adequacy: { minDenominatorClusters: 2, maxDenominatorWeightShare: 1 }, thresholds: { selectedOn: 'validation', maxFalseFoldUpper: 1, minCoverageLower: 0, minRecallLower: 0 } };
function fixture() {
  const samples = [], predictions = [];
  for (const [split, day] of [['development', '01'], ['validation', '02'], ['test', '03']]) for (let i = 0; i < 8; i++) {
    const id = `${split}-${i}`;
    samples.push({ id, authorGroup: `a-${id}`, threadGroup: `t-${id}`, contentHash: `h-${id}`, createdAt: `2025-01-${day}T00:00:00Z`, split, language: 'en', cohort: i === 7 ? 'difficult' : 'natural', inclusionProbability: i === 0 ? 0.5 : 1, label: i < 3 ? 'normal' : 'spam' });
    predictions.push({ sampleId: id, strategyId: 's', status: 'classified', predictedCategory: i < 3 ? 'normal' : 'spam', action: i < 3 ? 'keep' : 'fold', reasonCode: 'ok', contextState: 'available', latencyMs: i, modelCalls: 1 });
  }
  return { samples, predictions };
}
const natural = (report) => report.results.find((r) => r.split === 'test' && r.cohort === 'natural');

test('weighted rates, abstention and errors retain denominators, cohorts stay separate', () => {
  const { samples, predictions } = fixture();
  const p = predictions.find((x) => x.sampleId === 'test-3');
  Object.assign(p, { status: 'abstained', predictedCategory: null, action: 'keep', reasonCode: 'uncertain', contextState: 'missing' });
  Object.assign(predictions.find((x) => x.sampleId === 'test-0'), { status: 'error', predictedCategory: null, reasonCode: 'timeout' });
  predictions.find((x) => x.sampleId === 'test-1').action = 'fold';
  const r = evaluate(samples, predictions, manifest, hashes), n = natural(r);
  assert.equal(n.normalFalseFoldRate.value, 1 / 4);
  assert.equal(n.targetRecall.value, 3 / 4);
  assert.equal(n.classifiedCoverage.value, 5 / 8);
  assert.equal(n.semanticAbstention.value, 1 / 8);
  assert.equal(n.foldPrecision.value, 3 / 4);
  assert.equal(n.errorsByReason.timeout, 1);
  assert.equal(n.missingContextCount, 1);
  assert.equal(n.totalModelCalls, 7);
  assert.equal(r.results.find((x) => x.split === 'test' && x.cohort === 'difficult').sampleCount, 1);
});

test('cross-language cohort aggregates retain weighted metrics and connected clusters', () => {
  const { samples, predictions } = fixture();
  for (const s of samples) {
    const i = Number(s.id.split('-').at(-1));
    if (i === 1 || i === 4 || i === 7) s.language = 'zh';
    if (i === 1) s.inclusionProbability = 0.25;
    if (i === 7) s.inclusionProbability = 0.01;
  }
  for (const split of ['development', 'validation', 'test']) {
    const a = samples.find((s) => s.id === `${split}-0`), b = samples.find((s) => s.id === `${split}-1`), bridge = samples.find((s) => s.id === `${split}-7`);
    bridge.authorGroup = a.authorGroup; bridge.threadGroup = b.threadGroup;
    predictions.find((p) => p.sampleId === `${split}-1`).action = 'fold';
  }
  const report = evaluate(samples, predictions, manifest, hashes);
  const aggregate = report.results.find((r) => r.split === 'test' && r.cohort === 'natural' && r.language === null);
  assert.ok(aggregate);
  assert.equal(aggregate.sampleCount, 7);
  assert.equal(aggregate.independentClusters, 6);
  assert.equal(aggregate.normalFalseFoldRate.value, 4 / 7);
  assert.equal(aggregate.normalFalseFoldRate.denominatorWeight, 7);
  assert.equal(aggregate.normalFalseFoldRate.denominatorClusters, 2);
  assert.equal(aggregate.normalFalseFoldRate.maxDenominatorWeightShare, 6 / 7);
  assert.equal(aggregate.targetRecall.value, 1);
  assert.equal(report.results.find((r) => r.split === 'test' && r.cohort === 'natural' && r.language === 'zh').sampleCount, 2);
  assert.equal(report.results.find((r) => r.split === 'test' && r.cohort === 'difficult' && r.language === null).sampleCount, 1);
  assert.equal(report.releaseAuthorization.status, 'blocked');
});

test('required aggregate populations check all languages and retain cohort isolation', () => {
  const { samples, predictions } = passingFixture();
  for (const s of samples) if (s.label === 'spam') s.language = 'zh';
  const m = { ...manifest, requiredPopulations: [{ cohort: 'natural', language: null, categories: ['spam'] }] };
  let report = evaluate(samples, predictions, m, hashes);
  assert.equal(report.mechanicalChecks.status, 'passed');
  assert.equal(report.releaseAuthorization.status, 'blocked');
  const stringReport = evaluate(samples, predictions, manifest, hashes);
  assert.ok(stringReport.mechanicalChecks.reasons.some((reason) => reason.includes('spam denominator missing')));
  for (const s of samples) if (s.split === 'test' && s.label === 'spam') s.cohort = 'difficult';
  report = evaluate(samples, predictions, m, hashes);
  assert.ok(report.mechanicalChecks.reasons.some((reason) => reason.includes('test spam denominator missing')));
  assert.ok(report.mechanicalChecks.reasons.some((reason) => reason.includes('test spam predicted-fold denominator missing')));
  const absent = evaluate(samples, predictions, { ...m, requiredPopulations: [{ cohort: 'difficult', language: null, categories: ['spam'] }] }, hashes);
  assert.ok(absent.mechanicalChecks.reasons.some((reason) => reason.includes('validation population missing')));
  const missingLanguage = evaluate(samples, predictions, { ...m, requiredPopulations: [{ cohort: 'natural', categories: ['spam'] }] }, hashes);
  assert.ok(missingLanguage.mechanicalChecks.reasons.includes('requiredPopulations missing or invalid'));
});

test('rejects author, thread and content leakage and chronological overlap', () => {
  for (const key of ['authorGroup', 'threadGroup', 'contentHash']) {
    const { samples, predictions } = fixture(); samples[8][key] = samples[0][key];
    assert.throws(() => evaluate(samples, predictions, manifest, hashes), /crosses splits/);
  }
  const { samples, predictions } = fixture(); samples[16].createdAt = samples[8].createdAt;
  assert.throws(() => evaluate(samples, predictions, manifest, hashes), /strictly later/);
});

test('connected clusters include paths through another cohort', () => {
  const { samples, predictions } = fixture();
  const a = samples.find((s) => s.id === 'test-3'), b = samples.find((s) => s.id === 'test-4'), bridge = samples.find((s) => s.id === 'test-7');
  bridge.authorGroup = a.authorGroup; bridge.threadGroup = b.threadGroup;
  assert.equal(natural(evaluate(samples, predictions, manifest, hashes)).independentClusters, 6);
});

test('intervals are deterministic; sparse denominator clusters are unavailable', () => {
  const { samples, predictions } = fixture();
  const first = evaluate(samples, predictions, manifest, hashes);
  assert.deepEqual(first, evaluate(samples, predictions, manifest, hashes));
  assert.equal(natural(first).classifiedCoverage.interval, null);
  assert.match(natural(first).classifiedCoverage.reason, /degenerate/);
  const difficult = first.results.find((r) => r.split === 'test' && r.cohort === 'difficult');
  assert.equal(difficult.targetRecall.interval, null);
  assert.match(difficult.targetRecall.reason, /insufficient/);
  assert.equal(difficult.normalFalseFoldRate.value, null);
});

test('invalid records and missing or duplicate predictions are rejected', () => {
  for (const mutate of [
    (s, p) => s.push({ ...s[0] }),
    (s, p) => p.push({ ...p[0] }),
    (s, p) => p.pop(),
    (s, p) => { p[0].sampleId = 'unknown'; },
    (s, p) => { s[0].inclusionProbability = 0; },
    (s, p) => { s[0].createdAt = '2025-02-30T00:00:00Z'; },
    (s, p) => { s[0].postText = 'forbidden'; },
    (s, p) => { p[0].status = 'error'; },
  ]) { const { samples, predictions } = fixture(); mutate(samples, predictions); assert.throws(() => evaluate(samples, predictions, manifest, hashes)); }
});

test('gate needs valid frozen hashes, thresholds and independent intervals', () => {
  const { samples, predictions } = fixture();
  for (const s of samples) s.cohort = 'natural';
  assert.equal(evaluate(samples, predictions, manifest, hashes).mechanicalChecks.status, 'blocked');
  assert.equal(evaluate(samples, predictions, { ...manifest, datasetSha256: 'c'.repeat(64) }, hashes).mechanicalChecks.status, 'blocked');
  assert.equal(evaluate(samples, predictions, { ...manifest, predictionsSha256: 'c'.repeat(64) }, hashes).mechanicalChecks.status, 'blocked');
  const { thresholds: omittedThresholds, sourcePermission: omittedPermission, ...missingMetadata } = manifest;
  assert.equal(evaluate(samples, predictions, missingMetadata, hashes).mechanicalChecks.status, 'blocked');
  assert.throws(() => evaluate(samples, predictions, { ...manifest, thresholds: undefined }, hashes));
  assert.throws(() => evaluate(samples, predictions, { ...manifest, sourcePermission: '' }, hashes));
  const noTestSamples = samples.filter((s) => s.split !== 'test');
  const noTestPredictions = predictions.filter((p) => !p.sampleId.startsWith('test-'));
  assert.ok(evaluate(noTestSamples, noTestPredictions, manifest, hashes).mechanicalChecks.reasons.includes('test split missing'));
  assert.equal(evaluate(samples, predictions, { ...manifest, thresholds: { ...manifest.thresholds, minRecallLower: 1 }, strategyConfigs: {} }, hashes).mechanicalChecks.status, 'blocked');
  predictions.find((p) => p.sampleId === 'test-3').action = 'keep';
  assert.ok(evaluate(samples, predictions, { ...manifest, thresholds: { ...manifest.thresholds, minRecallLower: 1 } }, hashes).mechanicalChecks.reasons.some((r) => r.includes('threshold failed')));
  samples.filter((s) => s.split === 'test').forEach((s) => { s.authorGroup = 'one'; });
  assert.ok(evaluate(samples, predictions, manifest, hashes).mechanicalChecks.reasons.some((r) => r.includes('interval unavailable')));
});

test('CLI rejects inaccessible files without echoing paths or contents', () => {
  const result = spawnSync(process.execPath, [cliPath, 'private-file', 'x', 'y'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /private-file/);
});

function passingFixture() {
  const samples = [], predictions = [];
  for (const [split, day] of [['development', '01'], ['validation', '02'], ['test', '03']]) for (let i = 0; i < 20; i++) {
    const id = `${split}-${i}`, normal = i < 10;
    samples.push({ id, authorGroup: `a-${id}`, threadGroup: `t-${id}`, contentHash: `h-${id}`, createdAt: `2025-01-${day}T00:00:00Z`, split, language: 'en', cohort: 'natural', inclusionProbability: 1, label: normal ? 'normal' : 'spam' });
    predictions.push({ sampleId: id, strategyId: 's', status: i === 0 ? 'error' : 'classified', predictedCategory: i === 0 ? null : normal ? 'normal' : 'spam', action: i === 1 || i >= 12 ? 'fold' : 'keep', reasonCode: 'ok', contextState: 'available', latencyMs: 1, modelCalls: 1 });
  }
  return { samples, predictions };
}

test('rejects coercion, timestamp errors, unknown vocabulary and identifier aliases', () => {
  for (const mutate of [
    (s) => { s[0].split = ['test']; },
    (s) => { s[0].createdAt = ['2025-01-01T00:00:00Z']; },
    (s) => { s[0].createdAt = '2025-13-01T00:00:00Z'; },
    (s) => { s[0].label = 'promoo'; },
    (s) => { s[0].authorGroup += ' '; },
    (s) => { s[0].contentHash = 'a\nb'; },
    (s, p) => { p[0].predictedCategory = 'promoo'; },
  ]) { const { samples, predictions } = fixture(); mutate(samples, predictions); assert.throws(() => evaluate(samples, predictions, manifest, hashes)); }
  const { samples, predictions } = fixture(); samples[0].createdAt = samples[8].createdAt;
  assert.throws(() => evaluate(samples, predictions, manifest, hashes), /strictly later/);
});

test('duplicate content joins independent clusters, including across cohorts', () => {
  const { samples, predictions } = fixture();
  const a = samples.find((s) => s.id === 'test-3'), b = samples.find((s) => s.id === 'test-4'), bridge = samples.find((s) => s.id === 'test-7');
  bridge.contentHash = a.contentHash; bridge.threadGroup = b.threadGroup;
  assert.equal(natural(evaluate(samples, predictions, manifest, hashes)).independentClusters, 6);
});

test('degenerate bootstrap endpoints and interior values have no interval', () => {
  const { samples, predictions } = passingFixture();
  for (const p of predictions) p.action = p.predictedCategory === 'spam' ? 'fold' : 'keep';
  let r = natural(evaluate(samples, predictions, manifest, hashes));
  assert.equal(r.normalFalseFoldRate.value, 0); assert.match(r.normalFalseFoldRate.reason, /degenerate/);
  assert.equal(r.targetRecall.value, 1); assert.match(r.targetRecall.reason, /degenerate/);
  for (const s of samples) s.authorGroup = `${s.split}-cluster-${Number(s.id.split('-').at(-1)) % 2}`;
  for (const p of predictions) { p.status = 'classified'; p.predictedCategory = p.sampleId.endsWith('-0') ? 'spam' : p.predictedCategory ?? 'normal'; p.action = Number(p.sampleId.split('-').at(-1)) < 10 ? 'keep' : (Number(p.sampleId.split('-').at(-1)) < 14 ? 'fold' : 'keep'); }
  r = natural(evaluate(samples, predictions, manifest, hashes));
  assert.equal(r.targetRecall.value, 0.4); assert.match(r.targetRecall.reason, /degenerate/);
});

test('coincident percentile endpoints are unavailable even when some draws differ', () => {
  const samples = [], predictions = [];
  for (let i = 0; i < 100; i++) {
    const id = `sample-${i}`, normal = i < 6;
    samples.push({ id, authorGroup: `a-${id}`, threadGroup: `t-${id}`, contentHash: `h-${id}`, createdAt: '2025-01-01T00:00:00Z', split: 'test', language: 'en', cohort: 'natural', inclusionProbability: i < 5 ? 1e-20 : 1, label: normal ? 'normal' : 'spam' });
    predictions.push({ sampleId: id, strategyId: 's', status: 'classified', predictedCategory: normal ? 'normal' : 'spam', action: i < 5 ? 'fold' : 'keep', reasonCode: 'ok', contextState: 'available', latencyMs: 1, modelCalls: 1 });
  }
  let state = 42, zeroDraws = 0, emptyDraws = 0;
  for (let i = 0; i < 2000; i++) {
    let large = false, small = false;
    for (let j = 0; j < 100; j++) {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const index = Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * 100);
      if (index < 5) large = true; else if (index === 5) small = true;
    }
    if (!large && small) zeroDraws++; else if (!large) emptyDraws++;
  }
  assert.ok(zeroDraws > 0 && zeroDraws < (2000 - emptyDraws) * 0.025);
  assert.ok(emptyDraws < 100);
  const metric = natural(evaluate(samples, predictions, { ...manifest, bootstrapIterations: 2000 }, hashes)).normalFalseFoldRate;
  assert.equal(metric.value, 1);
  assert.equal(metric.interval, null);
  assert.match(metric.reason, /percentile endpoints coincide/);
});

test('non-finite cluster and summed totals are null and block validation or test adequacy', () => {
  const baseline = passingFixture();
  assert.equal(evaluate(baseline.samples, baseline.predictions, manifest, hashes).mechanicalChecks.status, 'passed');
  for (const split of ['validation', 'test']) for (const grouped of [false, true]) for (const bothFolded of [false, true]) {
    const { samples, predictions } = passingFixture();
    const a = samples.find((s) => s.id === `${split}-1`), b = samples.find((s) => s.id === `${split}-2`);
    a.inclusionProbability = b.inclusionProbability = 1e-308;
    if (grouped) b.authorGroup = a.authorGroup;
    predictions.find((p) => p.sampleId === b.id).action = bothFolded ? 'fold' : 'keep';
    const report = evaluate(samples, predictions, manifest, hashes);
    const result = report.results.find((r) => r.split === split && r.language === 'en');
    for (const metric of [result.normalFalseFoldRate, result.classifiedCoverage]) {
      assert.equal(metric.value, null);
      assert.equal(metric.interval, null);
      assert.equal(metric.denominatorWeight, null);
      assert.equal(metric.maxDenominatorWeightShare, null);
      assert.match(metric.reason, grouped ? /non-finite cluster .*total/ : /non-finite summed .*total/);
      assert.deepEqual(metric.bootstrapDraws, { attempted: 0, usable: 0, invalid: 0 });
    }
    assert.equal(report.mechanicalChecks.status, 'blocked');
    assert.ok(report.mechanicalChecks.reasons.some((reason) => reason.includes(`${split} normalFalseFoldRate adequacy failed`)));
    assert.equal(report.releaseAuthorization.status, 'blocked');
    const checkFinite = (value) => {
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
      else if (value && typeof value === 'object') Object.values(value).forEach(checkFinite);
    };
    checkFinite(report);
  }
});

test('bootstrap overflow counts invalid sums and requires at least 95% usable draws', () => {
  // With three clusters, only drawing the large cluster all three times overflows.
  // Seed 8 does this 10/200 times; seed 12 does it 11/200 times.
  for (const heavyFolded of [false, true]) for (const [seed, invalid] of [[8, 10], [12, 11]]) {
    const data = fixture();
    const samples = data.samples.filter((s) => ['test-0', 'test-1', 'test-2'].includes(s.id));
    const predictions = data.predictions.filter((p) => samples.some((s) => s.id === p.sampleId));
    samples.forEach((s, i) => { s.inclusionProbability = i === 0 ? 1.25e-308 : 1e-307; });
    predictions.forEach((p, i) => { p.action = i === 1 || (i === 0 && heavyFolded) ? 'fold' : 'keep'; });
    const metric = natural(evaluate(samples, predictions, { ...manifest, bootstrapSeed: seed, bootstrapIterations: 200 }, hashes)).normalFalseFoldRate;
    assert.ok(Number.isFinite(metric.denominatorWeight));
    assert.ok(Math.abs(metric.value - (heavyFolded ? 0.9 : 0.1)) < 1e-15);
    assert.deepEqual(metric.bootstrapDraws, { attempted: 200, usable: 200 - invalid, invalid });
    if (invalid === 10) {
      assert.ok(metric.interval);
      assert.equal(metric.reason, null);
      assert.ok(metric.interval.every(Number.isFinite));
    } else {
      assert.equal(metric.interval, null);
      assert.match(metric.reason, /fewer than 95% usable draws/);
    }
  }
  const { samples, predictions } = passingFixture();
  samples.find((s) => s.id === 'test-2').inclusionProbability = 1e-308;
  const report = evaluate(samples, predictions, manifest, hashes);
  const metric = natural(report).normalFalseFoldRate;
  assert.ok(Number.isFinite(metric.denominatorWeight));
  assert.ok(Number.isFinite(metric.value));
  assert.ok(metric.bootstrapDraws.invalid > manifest.bootstrapIterations * 0.05);
  assert.equal(metric.interval, null);
  assert.match(metric.reason, /fewer than 95% usable draws/);
  assert.equal(report.mechanicalChecks.status, 'blocked');
  assert.ok(report.mechanicalChecks.reasons.some((reason) => reason.includes('normalFalseFoldRate interval unavailable')));
});

test('sparse target denominators count empty bootstrap draws as invalid', () => {
  const { samples, predictions } = passingFixture();
  for (const s of samples) if (s.label === 'spam' && !s.id.endsWith('-11') && !s.id.endsWith('-12')) s.label = 'normal';
  const metric = natural(evaluate(samples, predictions, manifest, hashes)).targetRecall;
  assert.equal(metric.denominatorClusters, 2);
  assert.equal(metric.value, 0.5);
  assert.equal(metric.bootstrapDraws.attempted, manifest.bootstrapIterations);
  assert.equal(metric.bootstrapDraws.usable + metric.bootstrapDraws.invalid, manifest.bootstrapIterations);
  assert.ok(metric.bootstrapDraws.invalid > manifest.bootstrapIterations * 0.05);
  assert.equal(metric.interval, null);
  assert.match(metric.reason, /fewer than 95% usable draws/);
});

test('rejects model call totals that exceed the safe integer range', () => {
  const { samples, predictions } = fixture();
  predictions.find((p) => p.sampleId === 'test-0').modelCalls = Number.MAX_SAFE_INTEGER;
  predictions.find((p) => p.sampleId === 'test-1').modelCalls = 2;
  assert.throws(() => evaluate(samples, predictions, manifest, hashes), /model call total exceeds safe integer/);
});

test('category precision uses predicted category and classification recall requires a match', () => {
  const { samples, predictions } = passingFixture();
  for (const s of samples) if (s.label === 'spam') s.label = 'promo';
  for (const p of predictions) if (p.predictedCategory === 'spam') p.predictedCategory = 'repetition';
  const r = natural(evaluate(samples, predictions, manifest, hashes));
  const promo = r.categories.find((c) => c.category === 'promo'), repetition = r.categories.find((c) => c.category === 'repetition');
  assert.equal(promo.foldPrecision.value, null); assert.equal(promo.recall.value, 0); assert.equal(promo.foldActionRecall.value, 0.8);
  assert.equal(repetition.foldPrecision.value, 0);
  const m = { ...manifest, requiredPopulations: [{ cohort: 'natural', language: 'en', categories: ['promo'] }] };
  assert.ok(evaluate(samples, predictions, m, hashes).mechanicalChecks.reasons.some((x) => x.includes('predicted-fold denominator missing')));
});

test('candidate alone is gated; unsafe folds, missing populations and missing plan block', () => {
  const { samples, predictions } = passingFixture();
  const legacy = predictions.map((p) => ({ ...p, strategyId: 'legacy', ...(p.status === 'error' ? { action: 'fold' } : {}) }));
  const m = { ...manifest, strategyIds: ['s', 'legacy'], strategyConfigs: { s: config, legacy: { modelId: 'none', promptId: 'none', schemaId: 'legacy-schema', policyId: 'legacy-policy' } } };
  const report = evaluate(samples, [...predictions, ...legacy], m, hashes);
  assert.equal(report.mechanicalChecks.status, 'passed'); assert.equal(report.releaseAuthorization.status, 'blocked');
  assert.deepEqual(report.comparatorStrategyIds, ['legacy']);
  predictions[0].action = 'fold';
  assert.ok(evaluate(samples, [...predictions, ...legacy], m, hashes).mechanicalChecks.reasons.some((x) => x.includes('unsafe')));
  predictions[0].action = 'keep';
  for (const mutate of [
    { requiredPopulations: [{ cohort: 'difficult', language: 'en', categories: ['spam'] }] },
    { requiredPopulations: [{ cohort: 'natural', language: 'en', categories: ['promo'] }] },
  ]) assert.equal(evaluate(samples, [...predictions, ...legacy], { ...m, ...mutate }, hashes).mechanicalChecks.status, 'blocked');
  for (const update of [{ contextState: 'missing' }, { status: 'abstained', predictedCategory: null }]) {
    const p = predictions.find((x) => x.sampleId === 'test-12'); Object.assign(p, update);
    assert.equal(evaluate(samples, [...predictions, ...legacy], m, hashes).mechanicalChecks.status, 'blocked');
    Object.assign(p, { status: 'classified', predictedCategory: 'spam', contextState: 'available' });
  }
  samples.find((s) => s.id === 'test-12').label = 'uncertain';
  assert.ok(evaluate(samples, [...predictions, ...legacy], m, hashes).mechanicalChecks.reasons.some((x) => x.includes('unsafe')));
});

test('manifest vocabulary permits content categories and rejects undeclared or reserved labels', () => {
  const { samples, predictions } = passingFixture();
  const categories = ['engagement_bait', 'generic_irrelevant', 'content_free_restatement', 'future_content'];
  const m = { ...manifest, targetCategories: categories, requiredPopulations: [{ cohort: 'natural', language: 'en', categories: [categories[0]] }] };
  for (const s of samples) if (s.label === 'spam') s.label = categories[Number(s.id.split('-').at(-1)) % categories.length];
  for (const p of predictions) if (p.predictedCategory === 'spam') p.predictedCategory = categories[Number(p.sampleId.split('-').at(-1)) % categories.length];
  assert.deepEqual(natural(evaluate(samples, predictions, m, hashes)).categories.map((c) => c.category), categories);
  for (const targetCategories of [undefined, [], ['normal'], ['uncertain'], [' engagement_bait'], ['engagement_bait', 'engagement_bait']]) {
    assert.throws(() => evaluate(samples, predictions, { ...m, targetCategories }));
  }
  const p = predictions[12]; p.predictedCategory = 'praise_bot';
  assert.throws(() => evaluate(samples, predictions, m, hashes), /malformed prediction/);
  p.predictedCategory = 'uncertain';
  assert.throws(() => evaluate(samples, predictions, m, hashes), /malformed prediction/);
  p.predictedCategory = categories[0];
  samples[0].label = 'unknown';
  assert.throws(() => evaluate(samples, predictions, m, hashes), /malformed sample/);
  samples[0].label = 'normal';
  assert.ok(evaluate(samples, predictions, { ...m, requiredPopulations: [{ cohort: 'natural', language: 'en', categories: ['unknown'] }] }, hashes).mechanicalChecks.reasons.includes('requiredPopulations missing or invalid'));
});

test('every comparator has an exact frozen configuration', () => {
  const { samples, predictions } = passingFixture();
  const comparator = predictions.map((p) => ({ ...p, strategyId: 'other' }));
  const m = { ...manifest, strategyIds: ['s', 'other'], strategyConfigs: { s: config, other: { ...config, modelId: 'none' } } };
  const report = evaluate(samples, [...predictions, ...comparator], m, hashes);
  assert.deepEqual({ ...report.manifest.strategyConfigs }, m.strategyConfigs);
  assert.equal(report.mechanicalChecks.status, 'passed');
  for (const strategyConfigs of [{ s: config }, { ...m.strategyConfigs, extra: config }, { s: config, other: { modelId: 'none' } }]) {
    assert.ok(evaluate(samples, [...predictions, ...comparator], { ...m, strategyConfigs }, hashes).mechanicalChecks.reasons.includes('strategyConfigs missing or mismatch'));
  }
});

test('rejects unexpected manifest and hash fields without exposing synthetic secrets', () => {
  const { samples, predictions } = fixture();
  const secret = 'synthetic-secret-value';
  const variants = [
    { ...manifest, postText: secret },
    { ...manifest, apiKey: secret },
    { ...manifest, thresholds: { ...manifest.thresholds, apiKey: secret } },
    { ...manifest, adequacy: { ...manifest.adequacy, postText: secret } },
    { ...manifest, requiredPopulations: [{ ...manifest.requiredPopulations[0], apiKey: secret }] },
    { ...manifest, strategyConfigs: { s: { ...config, postText: secret } } },
  ];
  for (const m of variants) {
    assert.throws(() => evaluate(samples, predictions, m, hashes));
    const result = cli(samples, predictions, m);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /synthetic-secret-value|postText|apiKey/);
  }
  assert.throws(() => evaluate(samples, predictions, manifest, { ...hashes, apiKey: secret }));
  assert.throws(() => evaluate(samples, predictions, manifest, { ...hashes, manifestSha256: secret }));
});

test('manifest parser rejects malformed values without exposing markers', () => {
  const { samples, predictions } = fixture();
  const secret = 'SYNTHETIC_SECRET';
  const variants = [
    { thresholds: [secret] }, { sourcePermission: { apiKey: secret } },
    { strategyConfigs: [secret] }, { requiredPopulations: [secret] },
    ...Object.keys(manifest).map((k) => ({ [k]: null })),
    { bootstrapSeed: secret }, { bootstrapSeed: -1 }, { bootstrapIterations: 199 },
    { targetCategories: [secret, null] }, { strategyIds: ['s', { secret }] },
    { thresholds: { selectedOn: 'validation', minRecallLower: secret } },
    { adequacy: { minDenominatorClusters: [secret] } },
    { requiredPopulations: [{ cohort: 'natural', language: secret, categories: [null] }] },
    { requiredPopulations: [{ cohort: 'natural', language: null, categories: ['spam'], extra: secret }] },
    { strategyConfigs: { s: { ...config, policyId: [secret] } } },
    { strategyConfigs: JSON.parse('{"__proto__":{"apiKey":"SYNTHETIC_SECRET"}}') },
    { strategyConfigs: JSON.parse('{"constructor":{"apiKey":"SYNTHETIC_SECRET"}}') },
    { targetCategories: Array(1) }, { requiredPopulations: Array(1) },
  ];
  for (const variant of variants) {
    const m = { ...manifest, ...variant };
    assert.throws(() => evaluate(samples, predictions, m, hashes), (error) => !error.message.includes(secret));
    const result = cli(samples, predictions, m);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /SYNTHETIC_SECRET/);
  }
  for (const badHashes of [{ ...hashes, extra: secret }, { ...hashes, manifestSha256: secret }, { ...hashes, datasetSha256: null }, Object.defineProperty({ ...hashes }, 'extra', { value: secret })]) {
    assert.throws(() => evaluate(samples, predictions, manifest, badHashes), (error) => !error.message.includes(secret));
  }
  const inheritedHashes = Object.assign(Object.create({ manifestSha256: secret }), hashes);
  assert.doesNotMatch(JSON.stringify(evaluate(samples, predictions, manifest, inheritedHashes)), /SYNTHETIC_SECRET/);
});

test('prototype strategy keys are ordinary validated identifiers and report data is detached', () => {
  for (const id of ['__proto__', 'constructor', 'SYNTHETIC_SECRET']) {
    const { samples, predictions } = fixture();
    for (const p of predictions) p.strategyId = id;
    const strategyConfigs = JSON.parse(JSON.stringify({ [id]: config }));
    const m = { ...manifest, strategyIds: [id], candidateStrategyId: id, strategyConfigs };
    const report = evaluate(samples, predictions, m, hashes);
    assert.equal(Object.getPrototypeOf(report.manifest.strategyConfigs), null);
    assert.equal(report.manifest.strategyConfigs[id].modelId, 'model');
    assert.equal(report.candidateStrategyId, id);
    assert.equal(JSON.parse(cli(samples, predictions, m).stdout).candidateStrategyId, id);
    m.strategyConfigs[id].modelId = 'changed';
    m.requiredPopulations[0].categories.push('promo');
    assert.equal(report.manifest.strategyConfigs[id].modelId, 'model');
    assert.deepEqual(report.manifest.requiredPopulations[0].categories, ['spam']);
    m.requiredPopulations[0].categories.pop();
  }
});

test('missing metadata blocks while explicit undefined is malformed', () => {
  const { samples, predictions } = fixture();
  const report = evaluate(samples, predictions, { targetCategories: ['spam'] });
  assert.ok(report.mechanicalChecks.reasons.includes('missing sourcePermission'));
  assert.ok(report.mechanicalChecks.reasons.includes('missing or invalid bootstrapSeed'));
  assert.equal(report.releaseAuthorization.status, 'blocked');
  assert.throws(() => evaluate(samples, predictions, { targetCategories: ['spam'], bootstrapSeed: undefined }));
});

test('API manifest hash provenance distinguishes supplied hashes from original input serialization', () => {
  const { samples, predictions } = fixture();
  const original = { ...manifest, strategyConfigs: { s: { policyId: 'policy', modelId: 'model', schemaId: 'schema', promptId: 'prompt' } } };
  const report = evaluate(samples, predictions, original, hashes);
  assert.equal(report.manifestHashSource, 'JSON.stringify(original input)');
  assert.equal(report.inputHashes.manifestSha256, digest(JSON.stringify(original)));
  assert.notEqual(report.inputHashes.manifestSha256, digest(JSON.stringify(report.manifest)));
  const supplied = 'c'.repeat(64);
  const withHash = evaluate(samples, predictions, original, { ...hashes, manifestSha256: supplied });
  assert.equal(withHash.manifestHashSource, 'caller-supplied');
  assert.equal(withHash.inputHashes.manifestSha256, supplied);
});

for (const kind of ['direct', 'symlink', 'hardlink']) test(`real ${kind} CLI returns reports and rejects malformed or inaccessible files`, () => {
  const directory = mkdtempSync(join(dirname(cliPath), '.issue3-entry-'));
  try {
    const entry = kind === 'direct' ? cliPath : join(directory, `${kind}.mjs`);
    if (kind === 'symlink') symlinkSync(cliPath, entry);
    if (kind === 'hardlink') linkSync(cliPath, entry);
    const { samples, predictions } = passingFixture();
    const m = { ...manifest, datasetSha256: digest(JSON.stringify(samples)), predictionsSha256: digest(JSON.stringify(predictions)) };
    const valid = cli(samples, predictions, m, false, entry);
    assert.equal(valid.status, 2, valid.stderr);
    assert.equal(valid.stderr, '');
    const report = JSON.parse(valid.stdout);
    assert.equal(report.mechanicalChecks.status, 'passed');
    assert.equal(report.releaseAuthorization.status, 'blocked');
    assert.deepEqual(report.inputHashes, { datasetSha256: m.datasetSha256, predictionsSha256: m.predictionsSha256, manifestSha256: digest(JSON.stringify(m)) });
    assert.equal(report.manifestHashSource, 'caller-supplied');
    const malformed = cli(samples, predictions, m, true, entry);
    const inaccessible = spawnSync(process.execPath, [entry, join(directory, 'missing-private-file'), 'x', 'y'], { encoding: 'utf8', timeout: 10000 });
    for (const result of [malformed, inaccessible]) {
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^Evaluation failed:/);
      assert.doesNotMatch(result.stderr, /missing-private-file/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('simulated legacy entry fallback handles links and eval imports', () => {
  const directory = mkdtempSync(join(dirname(cliPath), '.issue3-legacy-'));
  try {
    const entry = join(directory, 'legacy.mjs');
    const source = readFileSync(cliPath, 'utf8');
    const guard = "if (typeof import.meta.main === 'boolean') return import.meta.main;";
    assert.ok(source.includes(guard));
    writeFileSync(entry, source.replace(guard, ''));
    const symlink = join(directory, 'symlink.mjs');
    const hardlink = join(directory, 'hardlink.mjs');
    symlinkSync(entry, symlink);
    linkSync(entry, hardlink);
    const { samples, predictions } = passingFixture();
    const m = { ...manifest, datasetSha256: digest(JSON.stringify(samples)), predictionsSha256: digest(JSON.stringify(predictions)) };
    for (const path of [entry, symlink, hardlink]) {
      const result = cli(samples, predictions, m, false, path);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(JSON.parse(result.stdout).releaseAuthorization.status, 'blocked');
    }
    const statement = `await import(${JSON.stringify(pathToFileURL(entry).href)})`;
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', statement, entry], { encoding: 'utf8', timeout: 10000 });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, '');
    assert.equal(imported.stderr, '');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('programmatic imports leave stdout, stderr, argv and exit status untouched', () => {
  const script = `import assert from 'node:assert/strict'; const argv = [...process.argv], exitCode = process.exitCode; const api = await import(${JSON.stringify(pathToFileURL(cliPath).href)}); assert.equal(typeof api.evaluate, 'function'); assert.deepEqual(process.argv, argv); assert.equal(process.exitCode, exitCode);`;
  // Also exercise a coinciding argv path when the runtime supplies main-module semantics.
  const argumentsToTest = typeof import.meta.main === 'boolean' ? [[], [cliPath]] : [[]];
  for (const args of argumentsToTest) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('CLI returns 2 for blocked release, 1 for malformed, and hashes exact manifest bytes', () => {
  const { samples, predictions } = passingFixture();
  const m = { ...manifest, datasetSha256: digest(JSON.stringify(samples)), predictionsSha256: digest(JSON.stringify(predictions)) };
  const pass = cli(samples, predictions, m);
  assert.equal(pass.status, 2, pass.stderr);
  const report = JSON.parse(pass.stdout);
  assert.equal(report.mechanicalChecks.status, 'passed');
  assert.equal(report.releaseAuthorization.status, 'blocked');
  assert.equal(report.inputHashes.manifestSha256, digest(JSON.stringify(m)));
  const changed = cli(samples, predictions, { ...m, strategyConfigs: { s: { ...config, policyId: 'changed' } } });
  assert.notEqual(JSON.parse(changed.stdout).inputHashes.manifestSha256, report.inputHashes.manifestSha256);
  assert.equal(cli(samples, predictions, { ...m, candidateStrategyId: 'missing' }).status, 2);
  assert.equal(cli(samples, predictions, m, true).status, 1);
});
