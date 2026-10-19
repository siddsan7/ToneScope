# Native level experiment

Run from the repository with the built CLI, installed service lockfile and Node24:

```powershell
python evals/level_eval.py --cli build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe --output artifacts/level-evaluation-new
```

The output folder must be new. `report.html` links all264 per-attempt records;
`summary.json` records source/runtime identities, evidence hashes, failures,
task-cluster bootstrap intervals, matched paired differences and zero actual model
spend. This is a separate development experiment, not release-gate evidence.
Existing `ai-replay`, `ai-live` and release checks retain their original behavior.

The frozen v1 corpus contains24 four-second stereo48kHz synthetic tasks from six
byte-pinned sources:8 level,4 headroom,4 no-op/silence,4 unsupported/ambiguous and4
injection cases. The canonical corpus digest is frozen in a separate lock file.
Tolerance is0.25dB for level,0.05dB for sample peak and1e-6 maximum sample error
for the authorized pure output-gain transformation. Editing a prompt, target,
source or tolerance requires an explicitly reviewed new corpus version; never
retune the lock to improve a model score.

Arms are unchanged audio, the production rules policy, single-model-no-tools,
tool-grounded and grounding-disabled. Baselines run once per task. Each model arm
has three scheduled repetitions. No provider execution option exists. Without
captures, all216 model records are explicitly blocked. Provider keys and Node
injection environment settings are stripped from children; live mode is forced
off. The bridge imports the service and native tools, never the paid adapter.

Baseline and candidate WAVs come from the actual native renderer. Independent
grading rereads samples and computes stereo RMS and sample peak. It verifies
frame/rate/channel identity, authorized output-only patches, realized gain,
target/delta/headroom and full waveform consistency. Plausible response metrics,
polarity inversion, channel swaps or delayed audio cannot substitute for the
correct rendered result. Silence has no finite dBFS in the grader. The service
adapter's -240dBFS floor is recorded only in decision context.

Task, decision, audio, runtime and critical authorization outcomes stay separate.
Failed attempted records remain zero scores in feasible-task denominators;
blocked records are excluded and counted explicitly. Intervals cluster all
repetitions by original task. Paired model comparisons use matching attempted
records only; partial capture coverage is not a full-corpus estimate. Six
synthetic source groups are not independent musical performances. Inspectable
development tasks are not a sequestered holdout. RMS/sample peak do not establish
perceived loudness, true peak, preference or musical quality.

## Offline captures

`--captures path.json` accepts a bounded file (5MiB, at most216 unique records):

```json
{
  "schema_version": 1,
  "corpus_sha256": "24012c5c889636662907b4401051ac7ffd687e6fc6287651e47178fad4c83c70",
  "records": [{
    "task_id": "attenuate-three",
    "arm": "single-model-no-tools",
    "repeat": 0,
    "capture": {
      "schema_version": 1,
      "provenance": {"kind": "scripted-test", "model": "none"},
      "actions": [{"kind": "render_candidate", "input": {"parameter_patch": [
        {"stage_id": "output", "parameter_id": "outputDb", "unit": "dB", "value": -3}
      ]}}]
    }
  }]
}
```

Use `imported-capture` for externally recorded actions; this label does not
authenticate their origin. Historical usage, if supplied, stays separate from
this run's zero actual calls/tokens/cost. Replay duration is not model latency.
Raw actions, rejected actions, process failures, decision inputs, tool feedback
and native candidate WAV/sidecar copies are retained, including rejected previews.

One-shot accepts exactly one `render_candidate`, `noop` or `abstain` action. Its
audio render/compare occurs after the recorded decision. Tool arms allow at most
two candidates and the production eight-tool/30-second budget. A candidate action
is followed by automatic comparison; terminal `propose_change` can carry a full
production proposal or just a parameter patch. Patch-only/one-shot adapters
synthesize the required host evidence and are explicitly marked evaluation
wrappers. They test chosen audio parameters, not model evidence construction,
and never authorize application to a product session.

`request-context.json` exports prompt, authorized controls, baseline measurements
and untrusted label. Evaluator objectives and expected answers stay private to
grading. `decision-inputs.json` retains actual bridge inputs and feedback. The
grounding-disabled arm removes initial/candidate/comparison audio measurements
while preserving numeric control values and bounds. Offline action replay proves
adapter behavior; a causal grounding claim still requires independently collected
model actions from each arm's actual feedback. No model qualification follows
from scripted captures.

Later live evaluation needs explicit consent, verified model/pricing/budgets,
an independent capture driver and a sequestered musical holdout. This harness
deliberately supplies no paid-call switch.
