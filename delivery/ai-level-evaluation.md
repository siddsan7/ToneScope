# Level evaluation harness

Goal: implement the frozen level-task experiment with real native renders,
production rules and no-intervention baselines, independent WAV grading, bounded
capture replay, and inspectable outcome reports. Paid provider execution stays
disabled; imported/scripted actions do not establish live-model competence.

Contracts: 24 inspectable development tasks, grouped source provenance, three
scheduled repetitions for each model arm, immutable corpus digest, strict
output-only authorization, real candidate files, task/decision/audio/runtime
scores kept separate, failures retained, no fabricated model latency or usage.
Keep existing numerical/release gates and blocked live qualification unchanged.

Model arms: one-shot, measured tool feedback, and measurement-withheld ablation.
The harness never instantiates a paid provider. Missing captures are blocked,
not mock successes. The one-shot and patch-only capture wrappers are evaluation
adapters and never authorize native application of a change.

Acceptance: deterministic locked fixtures and task definitions; actual baseline
renders; independent gain/target/headroom checks; rejection of forged metrics,
invalid patches, wrong audio and malformed captures; preserved raw actions and
tool history; zero paid calls; baseline confidence/paired summaries; existing
Python/native/protocol checks intact. Bounded workers own the native bridge and
audio grader; root owns corpus, runner, integration and final verification.

Implementation: `evals/level_tasks.py` owns strict JSON, fixture construction and
the corpus lock; `level_bridge.mjs` reuses actual service/native guards without
loading a paid adapter; `level_audio.py` grades WAV samples independently;
`level_eval.py` preserves per-attempt evidence and reports. Windows CI adds the
offline experiment after existing checks. Usage/capture format and interpretation
are in `docs/evaluation/level-experiment.md`.

Independent review corrected failed-attempt denominators (including boundary
tasks) and added executed Node/Zod bytes to runtime identity. Regressions prevent
failed attempts disappearing from estimates. Audio review added full waveform
gain consistency and retained every candidate before production cleanup.

Verified locally: Python71/71 without skips; native9/9; service typecheck and
24/24 tests without skips; existing contracts10/10, DSP12/12, integration7/7;
existing AI replay retains its required blocked live qualification and passes its
development checker. `git diff --check` passes. The first full locked-corpus run
and the baseline rerun each produce264 records with rules15/24, all216 model
records blocked, zero calls/cost and no infrastructure errors. They predate the
final boundary-denominator fix and are retained as intermediate evidence.

Evidence root: ignored `artifacts/ai-level-development/`. Restricted service tests
reproduced the known local-loopback access failure; unrestricted native-enabled
tests pass. The final integrated capture probe separately tests correct, wrong
and rejected actions for all three model arms; its final result is recorded below.
No hardware, human listening, live model, release or remote CI claim follows.

Next: independently collect provider-backed actions only after explicit consent,
model/pricing and budget verification; curate independent holdout tasks; expose
soft/hard passage evidence for the separate compression benchmark. Accessible
selection summary, narrated demo and external qualification remain separate work.

Final integrated result: `artifacts/ai-level-development/final-integrated/report.html`
and `summary.json`; completed264 records, unchanged source/runtime, zero
infrastructure errors and all922 evidence hashes independently rechecked. Rules
score15/24 versus unchanged3/24 (feasible11/18 versus3/18). Each model arm has
one correct scripted gain, one wrong gain and one rejected out-of-range gain;
69other records per arm remain blocked. All actions are explicitly scripted,
not model evidence. Historical synthetic cost metadata stays separate from
zero actual calls/cost. The final Python suite again passes71/71 with no skips
after the denominator fix. No existing gate/tolerance was weakened. Remote CI,
UI reruns and hardware/human checks were not performed for this eval-only change.
