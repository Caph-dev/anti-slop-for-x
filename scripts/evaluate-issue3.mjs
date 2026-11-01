#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const fail = (message) => { throw new Error(message); };
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\s\p{C}]/u.test(v);
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const fields = (v, keys) => object(v) && Reflect.ownKeys(v).every((k) => typeof k === 'string' && keys.includes(k));
const sha = (data) => createHash('sha256').update(data).digest('hex');
const ratio = (n, d) => d > 0 ? n / d : null;
const target = (c) => c !== 'normal' && c !== 'uncertain';

function validate(samples, predictions, targetCategories) {
  const sampleLabels = new Set(['normal', 'uncertain', ...targetCategories]);
  const predictionLabels = new Set(['normal', ...targetCategories]);
  if (!Array.isArray(samples) || !samples.length || !Array.isArray(predictions) || !predictions.length) fail('samples and predictions must be nonempty arrays');
  const ids = new Map(), seenGroups = new Map(), times = { development: [], validation: [], test: [] };
  for (const s of samples) {
    if (!fields(s, ['id', 'authorGroup', 'threadGroup', 'contentHash', 'createdAt', 'split', 'language', 'cohort', 'inclusionProbability', 'label']) ||
      !['id', 'authorGroup', 'threadGroup', 'contentHash', 'language', 'label'].every((k) => text(s[k])) ||
      typeof s.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s.createdAt) || !Number.isFinite(Date.parse(s.createdAt)) || new Date(s.createdAt).toISOString() !== s.createdAt.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`) ||
      typeof s.split !== 'string' || !Object.hasOwn(times, s.split) || !sampleLabels.has(s.label) || !['natural', 'difficult'].includes(s.cohort) ||
      typeof s.inclusionProbability !== 'number' || !(s.inclusionProbability > 0 && s.inclusionProbability <= 1) || !Number.isFinite(1 / s.inclusionProbability)) fail('malformed sample');
    if (ids.has(s.id)) fail('duplicate sample id');
    ids.set(s.id, s); times[s.split].push(Date.parse(s.createdAt));
    for (const k of ['authorGroup', 'threadGroup', 'contentHash']) {
      const key = JSON.stringify([k, s[k]]);
      if (seenGroups.has(key) && seenGroups.get(key) !== s.split) fail(`${k} crosses splits`);
      seenGroups.set(key, s.split);
    }
  }
  const validationMin = times.validation.reduce((min, t) => Math.min(min, t), Infinity);
  const testMin = times.test.reduce((min, t) => Math.min(min, t), Infinity);
  if (times.development.some((t) => t >= validationMin) || [...times.development, ...times.validation].some((t) => t >= testMin)) fail('splits must be strictly later in development, validation, test order');
  const pairs = new Set(), strategies = new Set();
  for (const p of predictions) {
    if (!fields(p, ['sampleId', 'strategyId', 'status', 'predictedCategory', 'action', 'reasonCode', 'contextState', 'latencyMs', 'modelCalls']) ||
      !text(p.sampleId) || !text(p.strategyId) || !['classified', 'abstained', 'error'].includes(p.status) ||
      !(p.status === 'classified' ? typeof p.predictedCategory === 'string' && predictionLabels.has(p.predictedCategory) : p.predictedCategory === null) ||
      !['keep', 'mark', 'fold'].includes(p.action) ||
      !text(p.reasonCode) || !['available', 'missing'].includes(p.contextState) ||
      typeof p.latencyMs !== 'number' || !Number.isFinite(p.latencyMs) || p.latencyMs < 0 || !Number.isSafeInteger(p.modelCalls) || p.modelCalls < 0) fail('malformed prediction');
    if (!ids.has(p.sampleId)) fail('prediction references unknown sample');
    const key = JSON.stringify([p.sampleId, p.strategyId]);
    if (pairs.has(key)) fail('duplicate prediction');
    pairs.add(key); strategies.add(p.strategyId);
  }
  for (const strategy of strategies) for (const id of ids.keys()) if (!pairs.has(JSON.stringify([id, strategy]))) fail('missing prediction');
  return { ids, strategies: [...strategies].sort() };
}

function clusters(rows) {
  const parent = rows.map((_, i) => i), groups = new Map();
  const root = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < rows.length; i++) for (const k of ['authorGroup', 'threadGroup', 'contentHash']) {
    const key = JSON.stringify([k, rows[i].sample[k]]);
    if (groups.has(key)) parent[root(i)] = root(groups.get(key)); else groups.set(key, i);
  }
  const result = new Map();
  rows.forEach((row, i) => { const r = root(i); if (!result.has(r)) result.set(r, []); result.get(r).push(row); });
  return [...result.values()];
}

function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6D2B79F5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function estimate(groups, numerator, denominator, seed, iterations) {
  const totals = groups.map((g) => g.reduce((a, r) => { const w = 1 / r.sample.inclusionProbability; a[0] += numerator(r) ? w : 0; a[1] += denominator(r) ? w : 0; return a; }, [0, 0]));
  const n = totals.reduce((a, x) => a + x[0], 0), d = totals.reduce((a, x) => a + x[1], 0);
  const finiteGroups = totals.every((x) => x.every(Number.isFinite));
  const denominatorClusters = totals.filter((x) => x[1] > 0).length;
  const share = finiteGroups && Number.isFinite(d) && d > 0 ? totals.reduce((max, x) => Math.max(max, x[1]), 0) / d : null;
  const details = { denominatorClusters, denominatorWeight: Number.isFinite(d) ? d : null, maxDenominatorWeightShare: Number.isFinite(share) ? share : null, bootstrapDraws: { attempted: 0, usable: 0, invalid: 0 } };
  const unavailable = (reason) => ({ value: null, interval: null, reason, ...details });
  if (!finiteGroups) return unavailable('non-finite cluster numerator or denominator total');
  if (!Number.isFinite(n) || !Number.isFinite(d)) return unavailable('non-finite summed numerator or denominator total');
  if (d <= 0) return unavailable('empty denominator');
  if (!Number.isFinite(share)) return unavailable('non-finite denominator weight concentration');
  const value = ratio(n, d);
  if (!Number.isFinite(value)) return unavailable('non-finite weighted ratio');
  if (denominatorClusters < 2) return { value, interval: null, reason: 'insufficient independent denominator clusters', ...details };
  const random = rng(seed), draws = [];
  for (let i = 0; i < iterations; i++) {
    let a = 0, b = 0;
    for (let j = 0; j < totals.length; j++) { const x = totals[Math.floor(random() * totals.length)]; a += x[0]; b += x[1]; }
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0 && Number.isFinite(a / b)) draws.push(a / b);
  }
  details.bootstrapDraws = { attempted: iterations, usable: draws.length, invalid: iterations - draws.length };
  if (draws.length * 100 < iterations * 95) return { value, interval: null, reason: 'unusable bootstrap: fewer than 95% usable draws (empty denominator or non-finite replicate numerator, denominator or ratio)', ...details };
  draws.sort((a, b) => a - b);
  const interval = [draws[Math.floor(0.025 * (draws.length - 1))], draws[Math.ceil(0.975 * (draws.length - 1))]];
  if (interval[0] === interval[1]) return { value, interval: null, reason: 'degenerate bootstrap: percentile endpoints coincide', ...details };
  return { value, interval, reason: null, ...details };
}

function parseManifest(input) {
  const manifestFields = ['datasetSha256', 'predictionsSha256', 'targetCategories', 'strategyConfigs', 'sourcePermission', 'humanAnnotation', 'splitMetadata', 'statisticalPlanId', 'bootstrapSeed', 'bootstrapIterations', 'strategyIds', 'candidateStrategyId', 'requiredPopulations', 'adequacy', 'thresholds'];
  const configFields = ['modelId', 'promptId', 'schemaId', 'policyId'];
  const malformed = () => fail('malformed manifest');
  const copyObject = (value, keys, validators) => {
    if (!fields(value, keys)) malformed();
    const out = {};
    for (const key of keys) if (Object.hasOwn(value, key)) {
      if (!validators[key](value[key])) malformed();
      out[key] = value[key];
    }
    return out;
  };
  const identifiers = (v) => Array.isArray(v) && Array.from(v).every(text);
  const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!fields(input, manifestFields)) malformed();
  const out = {};
  for (const key of ['datasetSha256', 'predictionsSha256']) if (Object.hasOwn(input, key)) { if (!hash(input[key])) malformed(); out[key] = input[key]; }
  for (const key of ['sourcePermission', 'humanAnnotation', 'splitMetadata', 'statisticalPlanId', 'candidateStrategyId']) if (Object.hasOwn(input, key)) { if (!text(input[key])) malformed(); out[key] = input[key]; }
  for (const key of ['targetCategories', 'strategyIds']) if (Object.hasOwn(input, key)) { if (!identifiers(input[key])) malformed(); out[key] = [...input[key]]; }
  if (Object.hasOwn(input, 'bootstrapSeed')) { if (!Number.isSafeInteger(input.bootstrapSeed) || input.bootstrapSeed < 0 || input.bootstrapSeed > 0xffffffff) malformed(); out.bootstrapSeed = input.bootstrapSeed; }
  if (Object.hasOwn(input, 'bootstrapIterations')) { if (!Number.isSafeInteger(input.bootstrapIterations) || input.bootstrapIterations < 200 || input.bootstrapIterations > 100000) malformed(); out.bootstrapIterations = input.bootstrapIterations; }
  if (Object.hasOwn(input, 'thresholds')) out.thresholds = copyObject(input.thresholds, ['selectedOn', 'maxFalseFoldUpper', 'minCoverageLower', 'minRecallLower'], { selectedOn: (v) => v === 'validation', maxFalseFoldUpper: unit, minCoverageLower: unit, minRecallLower: unit });
  if (Object.hasOwn(input, 'adequacy')) out.adequacy = copyObject(input.adequacy, ['minDenominatorClusters', 'maxDenominatorWeightShare'], { minDenominatorClusters: (v) => Number.isSafeInteger(v) && v >= 2, maxDenominatorWeightShare: (v) => unit(v) && v > 0 });
  if (Object.hasOwn(input, 'requiredPopulations')) {
    if (!Array.isArray(input.requiredPopulations)) malformed();
    out.requiredPopulations = Array.from(input.requiredPopulations, (p) => {
      const population = copyObject(p, ['cohort', 'language', 'categories'], { cohort: (v) => v === 'natural' || v === 'difficult', language: (v) => v === null || text(v), categories: identifiers });
      if (Object.hasOwn(population, 'categories')) population.categories = [...population.categories];
      return population;
    });
  }
  if (Object.hasOwn(input, 'strategyConfigs')) {
    if (!object(input.strategyConfigs)) malformed();
    out.strategyConfigs = Object.create(null);
    for (const key of Reflect.ownKeys(input.strategyConfigs)) {
      if (!text(key)) malformed();
      out.strategyConfigs[key] = copyObject(input.strategyConfigs[key], configFields, Object.fromEntries(configFields.map((field) => [field, text])));
    }
  }
  return out;
}

export function evaluate(samples, predictions, manifest = {}, hashes = {}) {
  const configFields = ['modelId', 'promptId', 'schemaId', 'policyId'];
  const originalManifest = manifest;
  manifest = parseManifest(manifest);
  const hashFields = ['datasetSha256', 'predictionsSha256', 'manifestSha256'];
  if (!fields(hashes, hashFields)) fail('malformed hashes');
  const parsedHashes = {};
  for (const key of hashFields) if (Object.hasOwn(hashes, key)) {
    if (typeof hashes[key] !== 'string' || !/^[a-f0-9]{64}$/.test(hashes[key])) fail('malformed hashes');
    parsedHashes[key] = hashes[key];
  }
  hashes = parsedHashes;
  const targetCategories = manifest.targetCategories;
  if (!Array.isArray(targetCategories) || !targetCategories.length || !targetCategories.every((c) => text(c) && target(c)) || new Set(targetCategories).size !== targetCategories.length) fail('invalid targetCategories');
  const { ids, strategies } = validate(samples, predictions, targetCategories);
  const seed = Number.isSafeInteger(manifest.bootstrapSeed) && manifest.bootstrapSeed >= 0 && manifest.bootstrapSeed <= 0xffffffff ? manifest.bootstrapSeed : 0;
  const iterations = Number.isSafeInteger(manifest.bootstrapIterations) && manifest.bootstrapIterations >= 200 && manifest.bootstrapIterations <= 100000 ? manifest.bootstrapIterations : 2000;
  const rows = predictions.map((p) => ({ sample: ids.get(p.sampleId), prediction: p }));
  const clusterIds = new Map();
  for (const split of ['development', 'validation', 'test']) {
    const splitRows = samples.filter((s) => s.split === split).map((sample) => ({ sample }));
    clusters(splitRows).forEach((group, index) => group.forEach((r) => clusterIds.set(r.sample.id, `${split}:${index}`)));
  }
  const results = [];
  const dimensions = new Map();
  for (const row of rows) {
    const { sample: s, prediction: p } = row;
    for (const language of [s.language, null]) {
      const key = JSON.stringify([s.split, p.strategyId, s.cohort, language]);
      if (!dimensions.has(key)) dimensions.set(key, []);
      dimensions.get(key).push(row);
    }
  }
  for (const [key, group] of [...dimensions].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const [split, strategyId, cohort, language] = JSON.parse(key), byCluster = new Map();
    for (const row of group) {
      const id = clusterIds.get(row.sample.id);
      if (!byCluster.has(id)) byCluster.set(id, []);
      byCluster.get(id).push(row);
    }
    const cs = [...byCluster.values()];
    const metric = (n, d) => estimate(cs, n, d, seed, iterations);
    const all = () => true, folded = (r) => r.prediction.action === 'fold';
    const categories = targetCategories.map((category) => ({
      category,
      foldPrecision: metric((r) => folded(r) && r.sample.label === category && r.prediction.predictedCategory === category, (r) => folded(r) && r.prediction.predictedCategory === category),
      recall: metric((r) => r.sample.label === category && folded(r) && r.prediction.predictedCategory === category, (r) => r.sample.label === category),
      foldActionRecall: metric((r) => r.sample.label === category && folded(r), (r) => r.sample.label === category),
    }));
    const errorsByReason = Object.create(null);
    for (const r of group) if (r.prediction.status === 'error') errorsByReason[r.prediction.reasonCode] = (errorsByReason[r.prediction.reasonCode] || 0) + 1;
    const latencies = group.map((r) => r.prediction.latencyMs).sort((a, b) => a - b);
    const totalModelCalls = group.reduce((n, r) => n + r.prediction.modelCalls, 0);
    if (!Number.isSafeInteger(totalModelCalls)) fail('model call total exceeds safe integer');
    results.push({ split, strategyId, cohort, language, sampleCount: group.length, independentClusters: cs.length,
      foldPrecision: metric((r) => folded(r) && target(r.sample.label), folded),
      targetRecall: metric((r) => folded(r) && target(r.sample.label), (r) => target(r.sample.label)),
      normalFalseFoldRate: metric((r) => folded(r) && r.sample.label === 'normal', (r) => r.sample.label === 'normal'),
      classifiedCoverage: metric((r) => r.prediction.status === 'classified', all),
      semanticAbstention: metric((r) => r.prediction.status === 'abstained', all),
      unsafeFoldCount: group.filter((r) => folded(r) && (r.prediction.status !== 'classified' || r.prediction.contextState === 'missing' || r.sample.label === 'uncertain')).length,
      errorsByReason, missingContextCount: group.filter((r) => r.prediction.contextState === 'missing').length,
      latencyMs: { min: latencies[0], median: latencies[Math.floor((latencies.length - 1) / 2)], p95: latencies[Math.ceil(0.95 * (latencies.length - 1))], max: latencies.at(-1) },
      totalModelCalls, categories });
  }
  const blocked = [];
  for (const k of ['sourcePermission', 'humanAnnotation', 'splitMetadata', 'statisticalPlanId']) if (!text(manifest[k])) blocked.push(`missing ${k}`);
  if (!Number.isSafeInteger(manifest.bootstrapSeed) || manifest.bootstrapSeed < 0 || manifest.bootstrapSeed > 0xffffffff) blocked.push('missing or invalid bootstrapSeed');
  if (!Number.isSafeInteger(manifest.bootstrapIterations) || manifest.bootstrapIterations < 200 || manifest.bootstrapIterations > 100000) blocked.push('missing or invalid bootstrapIterations');
  for (const k of ['datasetSha256', 'predictionsSha256']) if (!/^[a-f0-9]{64}$/.test(manifest[k] || '') || manifest[k] !== hashes[k]) blocked.push(`${k} missing or mismatch`);
  if (!Array.isArray(manifest.strategyIds) || !manifest.strategyIds.length || !manifest.strategyIds.every(text) || new Set(manifest.strategyIds).size !== manifest.strategyIds.length || JSON.stringify([...manifest.strategyIds].sort()) !== JSON.stringify(strategies)) blocked.push('strategyIds missing or mismatch');
  if (!object(manifest.strategyConfigs) || JSON.stringify(Object.keys(manifest.strategyConfigs).sort()) !== JSON.stringify(strategies) || !strategies.every((s) => fields(manifest.strategyConfigs[s], configFields) && configFields.every((k) => text(manifest.strategyConfigs[s][k])))) blocked.push('strategyConfigs missing or mismatch');
  if (!text(manifest.candidateStrategyId) || !strategies.includes(manifest.candidateStrategyId)) blocked.push('candidateStrategyId missing or mismatch');
  const populations = manifest.requiredPopulations;
  const validPopulations = Array.isArray(populations) && populations.length > 0 && populations.every((p) => fields(p, ['cohort', 'language', 'categories']) && ['natural', 'difficult'].includes(p.cohort) && (p.language === null || text(p.language)) && Array.isArray(p.categories) && p.categories.length > 0 && p.categories.every((c) => typeof c === 'string' && targetCategories.includes(c)) && new Set(p.categories).size === p.categories.length) && new Set(populations.map((p) => JSON.stringify([p.cohort, p.language]))).size === populations.length;
  if (!validPopulations) blocked.push('requiredPopulations missing or invalid');
  const adequacy = manifest.adequacy;
  const validAdequacy = fields(adequacy, ['minDenominatorClusters', 'maxDenominatorWeightShare']) && Number.isSafeInteger(adequacy.minDenominatorClusters) && adequacy.minDenominatorClusters >= 2 && typeof adequacy.maxDenominatorWeightShare === 'number' && Number.isFinite(adequacy.maxDenominatorWeightShare) && adequacy.maxDenominatorWeightShare > 0 && adequacy.maxDenominatorWeightShare <= 1;
  if (!validAdequacy) blocked.push('adequacy constraints missing or invalid');
  const t = manifest.thresholds;
  if (!object(t) || t.selectedOn !== 'validation' || !['maxFalseFoldUpper', 'minCoverageLower', 'minRecallLower'].every((k) => typeof t[k] === 'number' && Number.isFinite(t[k]) && t[k] >= 0 && t[k] <= 1)) blocked.push('validation thresholds missing or invalid');
  if (!samples.some((s) => s.split === 'validation') || !samples.some((s) => s.split === 'development')) blocked.push('development or validation split missing');
  const test = results.filter((r) => r.split === 'test');
  if (!test.length) blocked.push('test split missing');
  if (validPopulations) for (const population of populations) {
    const prefix = `${manifest.candidateStrategyId}/${population.cohort}/${population.language}`;
    for (const split of ['validation', 'test']) {
      const r = results.find((x) => x.split === split && x.strategyId === manifest.candidateStrategyId && x.cohort === population.cohort && x.language === population.language);
      if (!r) { blocked.push(`${prefix}: ${split} population missing`); continue; }
      const needed = ['normal', ...population.categories];
      for (const label of needed) if (!samples.some((s) => s.split === split && s.cohort === population.cohort && (population.language === null || s.language === population.language) && s.label === label)) blocked.push(`${prefix}: ${split} ${label} denominator missing`);
      for (const category of population.categories) if (r.categories.find((c) => c.category === category).foldPrecision.value === null) blocked.push(`${prefix}: ${split} ${category} predicted-fold denominator missing`);
      if (r.unsafeFoldCount) blocked.push(`${prefix}: ${split} unsafe candidate folds`);
      const checks = [['normalFalseFoldRate', 'maxFalseFoldUpper', 1, 'max'], ['classifiedCoverage', 'minCoverageLower', 0, 'min'], ['targetRecall', 'minRecallLower', 0, 'min'], ...population.categories.map((c) => [`category:${c}`, 'minRecallLower', 0, 'min'])];
      for (const [name, threshold, index, direction] of checks) {
        const metric = name.startsWith('category:') ? r.categories.find((c) => c.category === name.slice(9)).recall : r[name];
        if (validAdequacy && (!Number.isFinite(metric.value) || !Number.isFinite(metric.denominatorWeight) || !Number.isFinite(metric.maxDenominatorWeightShare) || !Number.isSafeInteger(metric.denominatorClusters) || metric.denominatorClusters < adequacy.minDenominatorClusters || metric.maxDenominatorWeightShare > adequacy.maxDenominatorWeightShare)) blocked.push(`${prefix}: ${split} ${name} adequacy failed`);
        if (split !== 'test') continue;
        if (!metric.interval) blocked.push(`${prefix}: ${name} interval unavailable`);
        else if (object(t) && typeof t[threshold] === 'number' && (direction === 'max' ? metric.interval[index] > t[threshold] : metric.interval[index] < t[threshold])) blocked.push(`${prefix}: ${name} threshold failed`);
      }
    }
  }
  if (text(manifest.candidateStrategyId) && rows.some((r) => r.prediction.strategyId === manifest.candidateStrategyId && r.prediction.action === 'fold' && (r.prediction.status !== 'classified' || r.prediction.contextState === 'missing' || r.sample.label === 'uncertain'))) blocked.push('candidate has unsafe folds');
  return { bootstrap: { seed, iterations, method: 'connected author/thread/content cluster percentile bootstrap' }, inputHashes: { ...Object.fromEntries(hashFields.filter((k) => Object.hasOwn(hashes, k)).map((k) => [k, hashes[k]])), manifestSha256: hashes.manifestSha256 ?? sha(JSON.stringify(originalManifest)) }, manifestHashSource: hashes.manifestSha256 ? 'caller-supplied' : 'JSON.stringify(original input)', manifest, results, candidateStrategyId: manifest.candidateStrategyId ?? null, comparatorStrategyIds: strategies.filter((s) => s !== manifest.candidateStrategyId), mechanicalChecks: { status: blocked.length ? 'blocked' : 'passed', reasons: blocked }, releaseAuthorization: { status: 'blocked', reasons: ['Independent statistical review and an approved dataset are required; mechanical checks cannot authorize release.'] } };
}

function main() {
  if (process.argv.length !== 5) fail('usage: node scripts/evaluate-issue3.mjs SAMPLES.json PREDICTIONS.json MANIFEST.json');
  const [samplesRaw, predictionsRaw, manifestRaw] = process.argv.slice(2).map((p) => readFileSync(p));
  const report = evaluate(JSON.parse(samplesRaw), JSON.parse(predictionsRaw), JSON.parse(manifestRaw), { datasetSha256: sha(samplesRaw), predictionsSha256: sha(predictionsRaw), manifestSha256: sha(manifestRaw) });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.releaseAuthorization.status === 'blocked') process.exitCode = 2;
}
function isMain() {
  if (typeof import.meta.main === 'boolean') return import.meta.main;
  if (!process.argv[1] || process.execArgv.some((arg) => /^-[ep]/.test(arg) || /^--(?:eval|print)(?:=|$)/.test(arg))) return false;
  // Older Node versions lack import.meta.main; compare file identity to handle both link types.
  try {
    const entry = statSync(process.argv[1], { bigint: true });
    const module = statSync(new URL(import.meta.url), { bigint: true });
    return entry.dev === module.dev && entry.ino === module.ino;
  } catch { return false; }
}
if (isMain()) {
  try { main(); } catch { process.stderr.write('Evaluation failed: invalid input, inaccessible file, or malformed JSON.\n'); process.exitCode = 1; }
}
