# Rules baseline improvement

Goal: fix explicit relative/target level intent, feasibility and no-op decisions
without changing the frozen level corpus, tool authorization or paid-call policy.
Keep unspecified louder/quieter behavior compatible with existing workflows.

Acceptance: frozen24-task score improves through production rules changes only;
separate paraphrase/decimal/nonzero-gain/headroom tests and independently measured
native audio exercise generalization; conflicting/unsupported intents abstain;
impossible exact targets do not become partial adjustments; negligible changes
do not render. Existing tests, corpus bytes and numerical gates remain intact.

Checks: focused rules tests, native generalization audio, full service/Python/native
checks, existing evaluation suites and blocked AI replay, frozen corpus rerun,
independent review, final diff inspection. No paid calls or release actions.

Implemented: `services/audio-assistant/agent/lib/level-intent.ts` owns bounded
normalization and parsing; `RulesProvider` calculates required delta from actual
RMS/current gain, checks control bounds and sample peak, and uses1e-5dB only for
float32 no-op noise. Exact nonzero changes require peak evidence. Vague requests
retain prior louder/quieter defaults. Proposals include actual RMS/peak evidence;
all existing preview, authorization, revision and explicit acceptance guards stay.

Independent read-only review found negation, unsupported numeric suffix,
constrained-keep, absent-reference, RMS-mention and peak-floor ambiguities. Fixes
abstain on those forms; separate regressions retain every reported case. First
new mock preview fixtures violated the existing minimum-measurement contract;
fixtures were corrected without weakening that contract. No frozen task changed.

Final local evidence: `artifacts/rules-baseline/verification.json`, per-check logs
and `frozen-level/report.html`. Rules24/24 (previous15/24), feasible18/18 and
boundary6/6; zero critical violations/infrastructure failures. All216 model
records blocked, zero actual calls/cost. Frozen corpus and lock raw bytes match
the previous experiment; canonical corpus digest remains
`24012c5c889636662907b4401051ac7ffd687e6fc6287651e47178fad4c83c70`.

Separate generalization:49 service cases and5 native tests/9 audio cases, using
noise/pulses at44.1/48/96kHz, decimals/number words, nonzero initial gain,
feasibility, no-ops, unsupported and conflicting requests. Independent WAV
grading retains existing0.25dB/0.05dB/1e-6 gates. This is authored development
coverage, not an independent holdout or unrestricted language understanding.

Final checks: service typecheck and73/73 tests, Python76/76, native9/9; existing
contracts10/10, DSP12/12, integration7/7; tool authorization/evidence mutation
checks detect2/2 disabled guards; required AI replay development gate passes
with live qualification blocked; actual embedded desktop assistant flow passes;
diff whitespace check passes. All required native/service/Python tests ran with
no skips. No remote CI, hardware or human qualification was performed.

Next: retain corpus v1 for regression; use separately authored/owned data for
broader generalization. Live model evaluation still needs explicit consent,
verified model/pricing and budget. Compression and accessible summaries remain
separate work. Do not interpret a tuned24-task score as general AI competence.

Final independent bounded review reran all12 previously reported reproductions
and confirmed safe abstention for each. Reviewer found no remaining issue in
the examined feasibility, peak, authorized-bound or no-op arithmetic.
