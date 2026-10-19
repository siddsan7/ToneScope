# Constrained compression benchmark

Goal: expose source/revision/selection-bound manual soft/hard passage evidence;
evaluate contrast reduction with fixed full-band compressor topology and bounded
threshold-only edits. Preserve the level corpus, all existing checks and paid-off
policy. No note/onset, perceptual, hardware or live-model claim.

Contracts: optional snapshot `passages` contains manual, disjoint soft/hard sample
intervals inside selection. Native baseline/candidate measurements add passage
RMS, sample peak and hard-minus-soft RMS contrast; unavailable energy is omitted,
never fabricated. Selection-relative native comparisons preserve full-history
render state. Passage metadata participates in request freshness/binding.

Baseline: explicit contrast-reduction requests only; compressor already enabled,
full-band, ratio/attack/release/knee/makeup fixed in authorized snapshot. Threshold
is the sole editable control. Calculate from measured hard level and ratio, then
render/compare at most two candidates under existing budgets. Abstain on missing
evidence, unsupported topology/intent, impossible bounds or unmet rendered goals;
return no-op for zero reduction. Every proposed patch still needs explicit apply.

Frozen development corpus, unchanged-audio/rules baselines, three blocked model
arms (three scheduled repeats), real native candidate evidence and independent
WAV grades cover contrast reduction, soft-level preservation, peak constraints,
wrong decisions/patches, missing evidence, infeasibility and adversarial requests.
Separate generalization/adversarial tests validate the evidence and grader.

Acceptance: verify fixture/task lock, metadata freshness, missing/silent/overlapping
passages and tampered audio; show actual baseline outcomes and retained failures;
all original numerical gates and no-paid-call guards remain intact. Main owns
contracts/integration/corpus/runner/final review. Isolated workers may own passage
adapter or independent grading; no concurrent root writers.

Implemented: `contracts.ts` binds optional manual passage intervals and processing
flags; `native-cli.ts` measures actual baseline/candidate passages and deltas.
`compression-rules.ts` supplies the bounded threshold-only policy. Desktop Context
and freshness carry the same metadata; acceptance independently recomputes both
baseline and candidate evidence from cached/cropped audio. Real native bridge
tests include a complete compression proposal and forged-passage rejection.
`compression_tasks.py`, frozen v1 JSON/lock, `compression_eval.py` and independent
`compression_audio.py` retain actual WAVs and evaluate outcomes separately from
decision/authorization/runtime results. Format and exact limits are documented
in `docs/evaluation/compression-experiment.md`. Windows CI adds the offline runner.

Independent review fixed a C++ declaration-order issue and retained every scheduled
record when a shared baseline render fails (both level and compression runners).
A regression guards those denominators. Other build failures were missing closing
initializer braces in the new C++ helper/test; corrected without altering checks.
Restricted default temp access failed the first grader invocation; the integrated
suite uses an explicit workspace temp folder. Failed logs remain in evidence.

Final local results: frozen compression16/16, unchanged audio1/16; feasible8/8 and
boundary8/8. Canonical frozen compression digest:
`cca0eba4819d4c8ca36ddea9d62b6a7be16c7e272998dc3fab85e364f415673c`.
Successful renders reduce contrast by2.52–9.02dB (pulse target3 achieves3.09dB),
with zero measured soft-passage RMS change. Default run has176 records, including
all144 blocked model repetitions; zero calls/cost and no infrastructure errors.
The separate scripted capture probe scores one correct threshold, one missed
target and one rejected ratio edit in each model arm;135 remaining records block.
These scripts are not model-performance measurements.

Existing frozen level corpus reruns24/24; its corpus and lock raw bytes match the
previous run. Final C++ build, service typecheck/build, service139/139, Python95/95,
native9/9, existing contracts10/10/DSP12/12/integration7/7, both authorization/evidence
mutants, startup/singleton and actual embedded assistant checks pass. Required
service/Python/native tests have no skips. Existing AI replay passes its development
checker while live qualification stays blocked. No numerical gate was weakened.
Reports and independent evidence-hash verification:
`artifacts/compression-benchmark/verification.json`, `first-experiment/report.html`,
`capture-probe/report.html`, `level-regression/report.html` and per-check logs.

Limitations/next: deliberately bounded grammar and neutral full-band/hard-knee
starting graph; metrics-only baseline assets cannot provide passage audio.
Authored synthetic/source-variant tests are not a musical holdout. Independent
musical evaluation, broader starting graphs, attack/perceptual tasks and consented
live-model evaluation remain separate work. No remote CI, hardware, listening,
accessibility qualification, merge or release was performed.
