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

Exit 0 means every case in the selected suite passed; 1 is a failed assertion; 2 means blocked infrastructure or a required pending case. DSP currently includes an explicit blocked qualification case; AI replay/live are blocked. A green implemented subset does not complete any requirement automatically. `run.json` enumerates missing passing families for **all** TS-001 through TS-016. Release validation aggregates actual case evidence across declared runs and requires every family for each shipped requirement. The coverage seed is not a completion claim.

Fixtures are generated deterministically in each case folder: seed 271828, mono/stereo IEEE float32 WAV, default 48 kHz. Noise channels differ to expose channel swaps; impulse positions differ per channel. The reader and generator use Python RIFF/struct math independently from the native decoder. Identity compares against quantized source samples, avoiding a double/float precision mismatch. Rendering must return actual source and artifact hashes. Every retained evidence file has its own SHA-256. Reports retain failures; they never rewrite baselines.

Frozen v1 numeric assertions: identity max absolute error <=1e-6; identity null RMS <=1e-5 (-100 dBFS); deterministic blocks <=1e-5; input/output dB gain <=1e-6 absolute error; steady hard-knee compressor transfer <=0.25 dB after 2.5 seconds of a three-second DC fixture; selected-region RMS <=1e-7 absolute error; sample peak/RMS <=0.1 dB; RMS match <=0.25 dB. Compressor timing is **not** inferred from the static test. Fixed block sizes 1/31/128/257/1024 test callback-size invariance with constant parameters, not sample-offset automation. Changes to these gates require ADR and dedicated baseline evidence.

Mutation self-tests deliberately apply incorrect gain, one-sample delay, channel swap and incorrect RMS normalization. They must detect every mutation. This proves sensitivity to those concrete faults only. Smoothing, schema-version and tool-validation mutation campaigns still need an instrumented product mutator; rejecting an ordinary malformed input is not mutation coverage.

Not yet qualified: independent EQ response, attack/release timing, crossover reconstruction, high-rate alias convergence, FFT calibration, alignment estimator, state-write interruption/migration, callback instrumentation, long hardware runs, licensed DI holdout, human listening/accessibility, installation, and live AI. Do not substitute synthetic results for these gates. Retention defaults: PR evidence 30 days, nightly failures 90 days, release evidence for the release lifetime; private human recordings follow consent-specific retention.
