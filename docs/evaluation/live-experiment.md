# Frozen live experiment infrastructure

`evals/live_freeze.py`, `live_evidence.py` and `live_collect.py` implement P1 of
`delivery/live-model-protocol.md`. Existing offline runners and locked development
corpora are unchanged. This infrastructure does not authorize paid calls.

The freeze contains 24 development level tasks, 16 development compression tasks,
and 16 privately authored transfer tasks. Each task has identical source, selection,
complete graph parameters, authorized controls and prompt across unchanged, rules
and three distinct model attempts: 280 records, including 168 model attempts.
Six setup and six named lifecycle slots remain separately reserved. The shared
production ledger caps all admissions at 180 and generations at 1,440. There are
no retries, alternate providers or best-repeat selection.
The freeze also seals a sorted request/prompt/role admission allowlist with
168 scored, six setup and six lifecycle identities. Additional slots use public
development prompts and explicit source/task templates. The collector guard can
admit scored/setup roles; native evaluation can admit only lifecycle roles.
An unused slot cannot be borrowed or rebound to another prompt/session.

Transfer requirements are four explicit level/headroom tasks, four compression
tasks, four feasible language variants outside the rules grammar, and four
negative/no-change tasks. Each task declares a family and reference decision.
The private pack includes four exact, unscaled, licensed DI excerpts from two
approved originals. The freeze checks original/member hashes against the existing
public corpus allowlist, attribution and exact decoded excerpt samples. Four
excerpts are two performances from one player, not four independent recordings.
Each ready task has an independently rendered native feasibility witness within
the same authorized range and fixed numerical gates. A missing or failed witness
blocks the freeze. Expected answers and witness controls never enter the provider
request or service asset.

Private task ownership gives procedural separation only. Shared repository access
cannot establish a sequestered holdout. The pack records author/exposure limits.
The root receives only counts and hashes before sealing. Prompts and references
must remain outside public source commits. Rebinding unchanged tasks to a final
binary preserves `transfer_sha256` while changing the experiment manifest digest.

Three locked development cases (`injection-filename`, `injection-credentials`,
`injection-false-measurement`) put adversarial text only in `untrusted_label`.
The production request/snapshot has no annotation channel. These labels remain
in the frozen local inputs and are not sent to Gateway. The report names these
three cases as not provider-exercised. Their level outcomes do not support an
annotation/filename injection safety claim. Only the explicit auto-apply main
prompt exercises that model-facing injection objective. Locked prompts are
unchanged; no evaluation-only provider channel was added.

## Offline preparation and checks

Use an ignored, fresh output directory. The private transfer path is supplied by
the evaluation owner; the CLI prints only aggregate counts and seal hashes.

```powershell
python evals/live_freeze.py --cli <native-cli> --transfer <private-transfer.json> --lockfile services/audio-assistant/package-lock.json --output artifacts/live-model-p1/final-freeze
python evals/live_collect.py --experiment artifacts/live-model-p1/final-freeze --cli <native-cli> --runtime <absolute-service-directory>
python evals/live_collect.py --experiment artifacts/live-model-p1/final-freeze --cli <native-cli> --runtime <absolute-service-directory> --offline-baselines
$env:TONESCOPE_TEST_CLI='<native-cli>'
$env:TONESCOPE_REQUIRE_NATIVE_TESTS='1'
$env:TONESCOPE_ASSISTANT_RUNTIME='<absolute-service-directory>'
python -m unittest discover -s tests/integration -p test_live_evidence.py -v
```

The default collector exports a blocked report. Offline baselines strip provider
credentials and use the existing production rules/native adapter. Each ready
preview is independently re-rendered from the complete parameters and compared
by WAV hash. The report reopens WAVs and recomputes grades instead of trusting
stored success flags. It checks full parameters, source/graph/selection bindings,
claimed metrics, file integrity, shape, sample timing, polarity, channel order,
authorized gain or linked attenuation, objective and new clipping. Native and
independent negative probes cover forged metrics, wrong selection, unauthorized
control, polarity, channel swap, timing shift and tampered audio. Compression
waveform checks establish linked attenuation, not a universal algorithm oracle.

Every attempted failure remains in the scheduled denominator. Thresholds use
separate development/transfer and level/compression integer ceiling counts.
Reports retain per-task paired results, all three repeats, decision/audio/task
outcomes, task-cluster intervals, latency, known cost and unresolved reservations.
Incremental transfer counts require an actually executed, comparable rules result.
All 112 scheduled unchanged/rules outcomes must be attempted and independently
graded before a combined comparison can pass; baseline failures remain failures.
Blocked or fault-injected records cannot qualify a live claim. Partial coverage
cannot pass. Repeats and shared-recording crops do not add independent examples.

The report and manifest are local HTML/JSON with relative artifact names,
complete graph snapshots and allowlisted service trace/accounting metadata.
Private host manifests, preview paths, consent files, credentials and raw errors
are excluded. The export scanner rejects private keys and local absolute paths
before writing exports. Native sidecars and bridge working files remain private.
Local hashes detect corruption; they do not authenticate an adversarially rewritten
entire evidence directory or prove independent human review.
Model credit also requires the exact structured service proposal and preview.
The graded patch must match the service proposal; WAV digest and preview identity
must match the unique verified-preview event and its earlier render/comparison.
Record, evidence and envelope status must agree. Replacing a numerically valid WAV,
patch, preview or status cannot transfer credit from a different model result.
Generated hypotheses, tradeoffs and limitations prose is redacted; structured
identities, evidence references, controls, acceptance requirement and preview
metadata remain available for these checks.
Each report reopens the hash-bound private consent and durable ledger. It checks
experiment/budget/consent identities, scheduled request/session hashes, unique
trace IDs, terminal usage, generation counts and ledger totals. Copied envelopes
and altered stored accounting fail. Interrupted admissions remain visible with
their confirmed or conservatively encumbered funds, without rerunning the slot.
Mutable records and report files use flushed temporary writes plus atomic
replacement. Three process-exit probes at each write/replace barrier establish
old-or-new complete JSON snapshots, not power-loss durability.
Transient Windows sharing locks permit only bounded retries of the same atomic
file replacement; persistent write failure leaves the previous complete snapshot.
Provider dispatch is never retried.

## Separate live opt-in

Only `live_collect.py --run-consented-experiment --consent <private-file>
--preflight <reviewed-P4-file>` can invoke the production
`agent/lib/live-collector.ts` Gateway entrypoint. It also requires the normal
experiment, CLI and runtime arguments. Consent is strict, fresh (24 hours), and
bound to exact protocol, task, schedule, model/provider, authoritative endpoint
metadata, admission allowlist, rates, full count ceilings, fixed service limits, approved text/scalar/
control/identity data and a funded total USD ceiling. Node validates and hashes
the policy to avoid cross-language decimal serialization errors. The production
Gateway independently verifies current endpoint capabilities and pricing before
generation. Environment credentials alone cannot authorize collection.

The P4 file must state `stage: P4`, `status: passed`, the exact manifest digest,
an independent review digest, passing checks and relative hashed evidence. The
collector checks current source, runtime, lockfile and binary identities and
requires compiled source identity to match. A rehearsal against an older binary
is therefore useful for offline checks but cannot dispatch paid calls. After
integration, rebuild and refreeze the same private pack before a scored run.

An attempt marker is saved before starting the production subprocess. Restart
cannot rerun an attempted slot. A subprocess failure, missing/corrupt evidence or
unknown admission stops collection and preserves the remaining blocked records.
Existing failed live attempts require review before any resume. Service
authorization/trace must establish live provenance, ordered dispatch and terminal
events, consistent snapshots and verified preview. The persistent request-keyed
ledger supplies confirmed cost, consumed generations and conservative unresolved
reservations. Local estimates are not provider invoices.
The shared `confirmed_usd` field means an estimate from confirmed token usage at
consented rate ceilings, including conservative cache/tier ceilings. It does not
mean confirmed provider invoice spend. Provider-reported billing remains separate
and unavailable unless explicitly reconciled; unresolved reservations stay separate.
Setup/lifecycle slots
need their separate P3/P4-live execution evidence in the same budget; this scored
collector does not simulate human acceptance.

No live-model, perceptual, hardware, human-listening, accessibility or user
acceptance qualification follows from deterministic checks. P4, explicit live
consent, P5 review and P6 human work remain separate gates.
