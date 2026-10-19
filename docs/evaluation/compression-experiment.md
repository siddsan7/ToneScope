# Constrained compression experiment

```powershell
python evals/compression_eval.py --cli build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe --output artifacts/compression-evaluation-new
```

Requires the current built CLI, installed service lockfile and Node24. Output must
be a new folder. `report.html` links per-attempt records; `summary.json` retains
source/runtime identities, tool traces, candidate files/sidecars, failures,
independent audio grades, paired task-cluster intervals and zero actual model
usage. This adds a development experiment; it never satisfies release/model gates.

The frozen v1 corpus has16 tasks from six byte-pinned synthetic stereo48kHz,
four-second sources. Seven tasks request contrast reduction, one requests no
change and eight require abstention. Cases include decimal targets, pulse/table
signals, absent/silent/equal passages, impossible threshold/soft constraints,
disabled/multiband compressors, unsupported attack claims and an untrusted label.
The canonical digest is
`cca0eba4819d4c8ca36ddea9d62b6a7be16c7e272998dc3fab85e364f415673c`.
Do not retune tasks, fixture bytes or numerical tolerances to improve outcomes.

Manual soft/hard labels are disjoint source-sample intervals, each at least two
samples, inside the selected source span. The snapshot carries origin/ranges and
processing flags. Source, graph, revision, selection, ranges and flags participate
in freshness checks. The native adapter reads the real baseline/candidate WAVs
for each passage and returns RMS, sample peak, hard-minus-soft contrast and
candidate deltas. RMS below1e-9 is explicitly unavailable, with no invented
contrast. Metrics-only assets cannot supply passage audio and fail explicitly.
Desktop marks outside the selected span are not exported as usable evidence.

The deterministic baseline accepts this bounded request form:

> Reduce the hard-soft RMS contrast by 3 dB while preserving the soft passage level and keeping sample peak below -1 dBFS.

Digits/decimal targets and the words zero/two/three/six are supported. Unsupported
phrases abstain. The compressor must already be enabled, full-band, initially
uncompressed (threshold0), hard knee, neutral input/output/makeup, with ratio above
unity, attack at most20ms and release at most200ms. EQ/drive/multiband remain off.
This policy changes only the authorized threshold; it cannot enable processing or
alter topology, gain, ratio or timing. Initial threshold comes from measured hard
RMS and ratio. At most two render/compare attempts can correct measured contrast;
both remain inside the existing eight-tool/thirty-second render budgets. Missing
evidence, unsafe constraints or unsuccessful candidates yield abstention. Every
ready proposal still requires user acceptance and normal preview/revision guards.

Grading independently rereads WAV samples using accurate energy sums. It checks
contrast reduction within0.5dB, soft RMS change at most0.5dB (plus0.05dB numerical
tolerance), overall sample peak at most-1dBFS (plus0.05dB tolerance), exact shape
and threshold-only authorization. Linked nonnegative attenuation checks reject
polarity/channel/time corruption and amplification. This waveform guard does not
prove compressor algorithm identity; actual CLI/binary/graph evidence binds the
render. No-op audio must meet the same objectives; correct abstention needs valid
baseline audio but does not invent unavailable passage measurements.

Arms are unchanged audio, production rules, single-model-no-tools, tool-grounded
and grounding-disabled. Three repetitions are scheduled per model arm. By
default all144 model records are blocked. There is no paid execution switch.
`--captures capture.json` reuses the bounded offline format documented in
`level-experiment.md`, using this corpus digest, task IDs and threshold patches.
Imported origin is unauthenticated; scripted captures test infrastructure only.
Patch-only/one-shot wrappers supply host evidence and do not test a model's
evidence construction. Grounding-disabled feedback withholds audio measurements;
control bounds and manual source positions remain available.

Baseline infrastructure failures retain every scheduled record. Failed attempted
tasks count as zero; blocked tasks stay separate. Repeats cluster by original
task, and paired comparisons use matching attempted records. Synthetic inspectable
tasks and authored generalization tests are not an independent musical holdout.
RMS is not perceived loudness, sample peak is not true peak, and soft/hard labels
are not detected notes or listening judgments. Live-model, musical-preference,
attack-preservation and hardware qualification remain separate work.
