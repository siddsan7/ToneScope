# Independent evaluation v1

Run from the repository root with Python 3.10+ (no packages):

```powershell
python evals/run.py --suite contracts --cli build/tonescope_cli.exe --output artifacts/contracts
python evals/run.py --suite dsp --cli build/tonescope_cli.exe --output artifacts/dsp
python evals/run.py --suite integration --cli build/tonescope_cli.exe --output artifacts/integration
python -m unittest discover -s tests/integration -v
python evals/run.py report --runs artifacts --out artifacts/report.html
python evals/run.py release-check --manifest artifacts/release-manifest.json
```

Exit 0 means every case in the selected suite passed; 1 is a failed assertion; 2 means blocked infrastructure or required qualification. Contracts, DSP and integration now execute their frozen required cases. AI replay executes explicit no-assistant and offline-rules protocol baselines; live provider qualification remains blocked. `run.json` enumerates missing passing families for all requirements. Release validation aggregates actual evidence and rejects incomplete coverage; a passing software subset does not complete a release.

Fixtures are generated deterministically in each case folder: seed 271828, mono/stereo IEEE float32 WAV, default 48 kHz. Noise channels differ to expose channel swaps; impulse positions differ per channel. The reader and generator use Python RIFF/struct math independently from the native decoder. Identity compares against quantized source samples, avoiding a double/float precision mismatch. Rendering must return actual source and artifact hashes. Every retained evidence file has its own SHA-256. Reports retain failures; they never rewrite baselines.

Frozen v1 numeric assertions: identity max absolute error <=1e-6; identity null RMS <=1e-5 (-100 dBFS); deterministic blocks <=1e-5; input/output dB gain <=1e-6 absolute error; steady hard-knee compressor transfer <=0.25 dB after 2.5 seconds of a three-second DC fixture; selected-region RMS <=1e-7 absolute error; sample peak/RMS <=0.1 dB; RMS match <=0.25 dB. Compressor timing is **not** inferred from the static test. Fixed block sizes 1/31/128/257/1024 test callback-size invariance with constant parameters, not sample-offset automation. Changes to these gates require ADR and dedicated baseline evidence.

Mutation self-tests deliberately apply incorrect gain, one-sample delay, channel swap and incorrect RMS normalization. They must detect every mutation. This proves sensitivity to those concrete faults only. Smoothing, schema-version and tool-validation mutation campaigns still need an instrumented product mutator; rejecting an ordinary malformed input is not mutation coverage.

Independent numerical gates now include complex EQ transfer, full compressor curve and attack/release crossings, phase-compensated crossover response, declared-delay alignment and a converged analytic/high-rate alias reference. See `docs/evaluation/numerical-oracles.md`; `gates.json` is the frozen machine-readable acceptance inventory. Aliasing conclusions apply to the declared periodic fixtures, not every transient or musical signal.

AI graders validate the actual B.3 proposal and service envelope, evidence identity, state/selection binding, authorization, abstention, cancellation and hostile content. Native assistant integration tests render and measure real candidates; fixtures never count as model competence. The grouped seed corpus is inspectable regression data, not an unseen holdout. See `docs/evaluation/ai-and-corpus.md` and the assistant model/data/tool cards.

Every run records source identity, evaluator/gate/runtime hashes, commit, initial/final dirty state and unchanged-source/runtime checks. The renderer embeds its compiled source identity through `build-info`; release-check rejects a stale or dirty binary even when its executable hash is supplied. Hashes establish consistency, not independent reviewer authenticity or a signing attestation. Final release evidence must come from the clean integrated commit.

For required native assistant tests set `TONESCOPE_TEST_CLI` to the executable and `TONESCOPE_ASSISTANT_RUNTIME` to the **service directory**. CI sets `TONESCOPE_REQUIRE_NATIVE_TESTS=1`, making missing dependencies a failure instead of a skip. Hardware callback timing/soak, licensed independently owned holdout, human listening/accessibility, signed clean-machine installation and actual provider-backed model quality remain unperformed. Retention: PR evidence30 days, nightly failures90 days, release evidence for release lifetime; human recordings follow consent-specific retention.
