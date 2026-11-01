# Issue #3 offline evaluation

This tool measures labelled content quality, not AI authorship. Use only an actually permitted and annotated dataset. Inputs must contain metadata only, never post text; unknown sample, prediction, and manifest fields (including nested configuration fields) are rejected. The tool writes its report to stdout and generic errors to stderr, and makes no network requests. Field allowlists cannot detect secrets embedded in otherwise valid strings. Valid opaque identifiers, language, strategy IDs, metadata references and reason codes can appear in the report, even when they contain a string resembling a secret. Do not put sensitive data in these fields: validation is not generic secret detection.

```sh
node scripts/evaluate-issue3.mjs samples.json predictions.json manifest.json
node --test scripts/tests/evaluate-issue3.test.mjs
```

Exit status is 2 whenever release authorization is blocked, including a mechanical pass, and 1 for malformed inputs or inaccessible files. An exit 2 report is still readable JSON on stdout. **Release authorization is always blocked**: the sampling method and real dataset require independent review and approval, represented by a future independently reviewed method and certificate. A synthetic fixture, a mechanical pass, a manifest claim, or a hash cannot grant production approval.

Direct, symlink and hardlink CLI invocations use the same entry behavior. On runtimes with `import.meta.main`, importing `evaluate` does not run the CLI. On older runtimes the fallback excludes `node -e` and `node -p`, then compares filesystem identity; a host that rewrites `process.argv[1]` to the evaluator's path can still be mistaken for the CLI. This project declares no Node `engines` requirement, so availability of `import.meta.main` cannot be assumed. Verification for this change used Node v24.15.0, which provides it; the fallback has not been run on Node 20.

## Inputs

Files are UTF-8 JSON arrays for samples and predictions, plus a JSON manifest. All identifiers, language codes, metadata references and reason codes must be nonempty strings of at most 200 characters, without whitespace or Unicode control/format characters. Group IDs are stable opaque identifiers; `contentHash` is a precomputed deduplication identifier, not content. Comparisons use exact strings: aliases for the same author, thread or content, Unicode normalization variants and homoglyphs are not detected or merged. Resolve aliases and normalize identifiers consistently before constructing frozen splits; the evaluator cannot establish independence when related records use different identifiers.

```json
[{"id":"opaque-1","authorGroup":"author-1","threadGroup":"thread-1","contentHash":"hash-1","createdAt":"2025-01-01T00:00:00Z","split":"development","language":"en","cohort":"natural","inclusionProbability":0.5,"label":"normal"}]
```

`createdAt` must be a valid UTC ISO timestamp with seconds and optional fractional seconds. Splits are `development`, `validation`, `test`, in strictly increasing time order. Cohorts are `natural` and `difficult`. The required manifest `targetCategories` array freezes the content-quality target vocabulary, for example `engagement_bait`, `generic_irrelevant`, and `content_free_restatement`; additional explicitly declared content categories are allowed. It must be nonempty, contain unique valid identifiers, and exclude the reserved labels `normal` and `uncertain`. Sample labels must be `normal`, `uncertain`, or a declared target; classified predictions must be `normal` or a declared target. Represent uncertain predictions using status `abstained`, not a category. Unknown and padded labels are rejected. Inclusion probabilities must be finite, greater than zero and at most one, with finite inverse.

```json
[{"sampleId":"opaque-1","strategyId":"strategy-1","status":"classified","predictedCategory":"normal","action":"keep","reasonCode":"ok","contextState":"available","latencyMs":10,"modelCalls":1}]
```

Every strategy must predict every sample exactly once. The input author must explicitly map comparator outputs to `normal` or the declared content categories; the evaluator never silently remaps them. Status is `classified`, `abstained`, or `error`; the last two require null category. Actions are `keep`, `mark`, `fold`; context is `available` or `missing`. Latency is nonnegative and finite; calls are a nonnegative safe integer. Actual legacy folds on error, abstention or missing context can be recorded for comparison. The candidate is blocked if it folds any such case or an `uncertain` label, in any split or population. Author groups, thread groups and content hashes must not cross splits. Connected components sharing any of these identifiers within a split are treated as clusters, even when connected through another cohort or language.

## Frozen Contract

A manifest must predeclare the candidate, every required cohort/language population and its required categories, statistical plan, adequacy limits, thresholds and input hashes. Identifiers below are placeholders, not permission claims or recommended thresholds. No numeric quality threshold or adequacy value is supplied here: select and document these before examining test results, with independent statistical advice.

```json
{
  "datasetSha256":"<64 lowercase hexadecimal characters>",
  "predictionsSha256":"<64 lowercase hexadecimal characters>",
  "targetCategories":["engagement_bait","generic_irrelevant","content_free_restatement"],
  "strategyConfigs":{
    "<candidate>":{"modelId":"<identifier>","promptId":"<identifier>","schemaId":"<identifier>","policyId":"<identifier>"},
    "<comparator>":{"modelId":"none","promptId":"none","schemaId":"<identifier>","policyId":"<identifier>"}
  },
  "sourcePermission":"<permission-reference>",
  "humanAnnotation":"<annotation-and-adjudication-reference>",
  "splitMetadata":"<split-construction-reference>",
  "statisticalPlanId":"<predeclared-plan-reference>",
  "strategyIds":["<candidate>","<comparator>"],
  "candidateStrategyId":"<candidate>",
  "requiredPopulations":[{"cohort":"natural","language":"en","categories":["engagement_bait"]}],
  "adequacy":{"minDenominatorClusters":"<integer-at-least-2>","maxDenominatorWeightShare":"<number-in-(0,1]>"},
  "bootstrapSeed":"<unsigned-32-bit-integer>",
  "bootstrapIterations":"<integer-from-200-to-100000>",
  "thresholds":{"selectedOn":"validation","maxFalseFoldUpper":"<number-in-[0,1]>","minCoverageLower":"<number-in-[0,1]>","minRecallLower":"<number-in-[0,1]>"}
}
```

The angle-bracket values must be replaced with appropriate strings or numbers, as indicated. Set a required population's `language` explicitly to `null` to gate the entire cohort across all languages; a string selects only that language. The field must be present, and natural and difficult cohorts remain separate. Every strategy, including comparators, must have exactly one `strategyConfigs` entry keyed by its exact strategy ID, with all four identifiers; use the explicit string `none` only when a field genuinely does not apply. Each required population category must be declared in `targetCategories`. The report includes these self-reported configurations in its manifest; it cannot verify that the stated configurations were actually used. Each required population must occur in both validation and test with normal and each required category represented, and with a predicted-fold denominator for each required category. Candidate checks require validation and test adequacy for the normal, coverage, aggregate target and required-category recall denominators. Test checks additionally require available bootstrap intervals satisfying the declared bounds. Missing splits, populations, denominators, plan, constraints, hashes, intervals or unsafe candidate folds block the mechanical checks (`mechanicalChecks`). Comparators are reported separately and do not determine candidate passage. Threshold selection, model identity, inclusion probabilities, permission, annotation quality and plan chronology are claims the program cannot verify.

The CLI report contains the validated manifest and SHA-256 hashes of exact sample, prediction and manifest input bytes. Missing metadata blocks mechanical checks, while malformed provided values (including null except for population language) cause an error. For the programmatic API, sample and prediction hashes are caller-supplied when present; it does not recompute them. A supplied manifest hash is reported with `manifestHashSource: "caller-supplied"`; the evaluator cannot verify how that hash was obtained. The CLI computes the exact-byte hashes and supplies them to the API, so its source label is also `caller-supplied`. Without a supplied manifest hash, the API hashes `JSON.stringify` of the original manifest input object before parsing or field reordering, and reports `manifestHashSource: "JSON.stringify(original input)"`. This is neither the original file bytes nor a canonical JSON representation. Hashes identify bytes but cannot establish their origin, authenticity, approval, or whether the manifest was frozen before test outcomes were seen. Protect and independently timestamp the plan and inputs as appropriate.

## Metrics And Limitations

For each split/strategy/cohort the report includes each language separately and an additional all-language result with `language: null`; it never combines natural and difficult cohorts. The aggregate uses the same connected clusters and metrics as the language-specific results, including connections through other languages or cohorts, but only records in the selected cohort contribute to its metrics. Within each result, all rates are inverse-inclusion-probability weighted. Fold precision is target-labelled folds divided by all folds; target recall is folded target-labelled records divided by all target-labelled records; normal false-fold rate is folded normal records divided by all normal records. Classified coverage and semantic abstention use all records. Errors and abstentions remain in the relevant denominators. Uncertain labels remain in coverage and overall fold-precision denominators, but are neither normal nor target.

Category precision is correctly labelled folds predicted as that category divided by all folds predicted as that category. Category classification recall requires both a fold and the matching predicted category; `foldActionRecall` separately measures folds of the labelled category regardless of prediction. Each metric reports the number of denominator-bearing clusters, total denominator weight and largest cluster's share of denominator weight. Finite per-record inverse probabilities do not guarantee finite cluster totals or overall sums. Non-finite cluster numerator/denominator totals, summed numerator/denominator totals, ratios or concentration yield a null value and interval with a stage-specific reason; unavailable weight/concentration diagnostics are explicitly null. Adequacy rejects unavailable or non-finite values, denominator weights and concentration in both validation and test. Error counts, missing-context counts, latencies and model calls are unweighted descriptive summaries. If a reported subgroup's model-call total exceeds the safe integer range, evaluation fails instead of reporting a rounded count.

The percentile bootstrap resamples connected author/thread/content clusters within each subgroup, keeping their records and weights, and uses empirical 2.5th and 97.5th percentiles. A fixed seed and input order reproduce draws. A usable draw requires finite numerator and denominator sums, a positive denominator and a finite ratio. A finite ratio alone is insufficient: a finite numerator divided by an overflowing denominator would misleadingly yield zero. Every attempted draw counts toward the pre-filter total, and at least 95% of all attempted draws must be usable (for 200 attempts, 190 usable draws suffice and 189 do not). Each metric's `bootstrapDraws` reports `attempted`, `usable` and `invalid`; all are zero if bootstrap was not attempted. Fewer than 95% usable draws retain the finite original point estimate but yield a null interval with an explicit reason. Otherwise percentiles use only usable draws. This threshold is an operational rule, not a guarantee of statistical validity; excluding draws can introduce selection effects.

An empty original denominator, fewer than two denominator clusters, or coincident reported percentile endpoints, even when some draws differ, also makes the interval unavailable. Sparse target categories can have many records overall yet too few target-bearing clusters, many empty-denominator bootstrap draws, or degenerate intervals. Required categories need their own adequate denominators and intervals; a large overall sample does not establish target adequacy. Null required test intervals block mechanical checks. No Wilson, rule-of-three or effective-sample-size replacement is applied.

This procedure assumes independent clusters and representative samples with correctly specified inclusion probabilities. It is not independently validated for arbitrary unequal-probability clustered sampling. Weight concentration, few clusters, correlated clusters, label error, temporal drift, biased inclusion probabilities and multiple comparisons can make intervals unreliable; reported denominator counts and concentration are diagnostics, not proof of validity. The predeclared plan must justify the sampling design, adequacy limits, target populations, thresholds and multiplicity handling. A mechanical pass covers only the populations and categories explicitly declared in `requiredPopulations`; the evaluator cannot detect omitted languages, cohorts or categories or certify the completeness of that declaration. Mechanical checks cannot substitute for independent review, and no output automatically authorizes release.
