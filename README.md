# ToneScope

A Windows guitar-effects workbench: **select a passage → adjust → freeze RMS match → listen and verify.** ToneScope makes the settings and measurements behind an audio comparison inspectable.

## Hear it and inspect the evidence

The [local listening bench](docs/showcase/README.md) generates **four attributed guitar DI examples and three measured plots** from the existing renderer. Its browser page includes dry/processed audio, RMS-matched audition copies, raw renders, settings, and binary/source hashes. A reviewer can open the generated page without building the desktop app. The [80-second walkthrough script](docs/showcase/walkthrough.md) covers the desktop comparison; a narrated video remains to be recorded.

```powershell
python scripts/acquire-public-corpus.py --output .tools/public-corpus/P3_music.zip
python scripts/build-showcase.py --archive .tools/public-corpus/P3_music.zip --cli build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe --output artifacts/showcase
Start-Process artifacts/showcase/index.html
```

The generator needs an existing native CLI; build instructions follow below. It runs offline after archive acquisition and refuses an existing output folder. The examples use two public Guitar-TECHS performances under CC BY 4.0, with attribution and transformation notes beside the audio. They are inspectable regression data. See the [corpus protocol](docs/evaluation/public-corpus.md).

## Engineering decisions

- **Measure the change.** Aligned comparison, residuals, actual gain reduction, and frozen RMS match expose what the controls did. Independent curve, timing, transfer, and oversampling references check defined numerical behavior.
- **Keep audio predictable.** C++20 hosts Faust DSP, control smoothing, crossover and resampling. The callback avoids allocation, locks, filesystem access, UI, logging, and networking. Bounded streaming reconstructs source history for selected renders.
- **Give Faust ownership of state.** The [linked RMS compressor](docs/showcase/compressor.md) owns detection, attack/release state, and stereo gain application in a persistent Faust graph. C++ supplies smoothed controls and routing. Existing independent numerical gates still define its behavior.
- **Keep suggestions reviewable.** The optional assistant uses native measurements and rendered previews. Apply is explicit and undoable. Offline level rules provide the current baseline; paid model evaluation remains future work.

A bundled React/shadcn interface presents the microscope inside JUCE. Implemented features include persistent dry capture/recovery, 1x/2x/4x drive, phase-compensated multiband compression, same-band audition, desktop transport, and private development packaging.

**Status: development software; external qualification remains.** Numerical checks do not establish preferred tone, hardware performance, accessibility effectiveness, or real-model quality. RMS is not perceptual loudness; sample peak is not true peak. Public executable release remains gated by review, licensing, signing, and clean-machine qualification. See [current working state](delivery/brain.md).

## Build on Windows x64

Visual Studio 2022 with Desktop C++, Windows SDK, Python 3.12, Node 24 and Git are required. The embedded UI uses the Evergreen WebView2 runtime; its build SDK is pinned and fetched by CMake. Core-only tests need a C++20 compiler and CMake.

```powershell
./scripts/bootstrap.ps1
./.tools/python/cmake/data/bin/cmake.exe --preset windows-dev
./.tools/python/cmake/data/bin/cmake.exe --build --preset windows-dev -- /m:1 /nr:false
./.tools/python/cmake/data/bin/ctest.exe --preset windows-dev
./build/windows-dev/ToneScope_artefacts/Release/ToneScope.exe
```

`/m:1` avoids nested MSBuild parallelism on modest laptops. The standalone renderer is `build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe`.

```powershell
./scripts/tonescope.ps1 render --source input.wav --out output.wav
./scripts/tonescope.ps1 eval --suite contracts --output artifacts/contracts
./scripts/tonescope.ps1 eval --suite integration --output artifacts/integration
./scripts/tonescope.ps1 eval --suite dsp --output artifacts/dsp
./scripts/tonescope.ps1 report --runs artifacts --out artifacts/report.html
```

Evaluations return 0 for the executed suite passing, 1 for failure and 2 for blocked infrastructure/required qualification. Passing the bounded DSP suite does not qualify hardware, listening or universal audio quality. Render output is float32 WAV with a hash manifest; existing WAVs or sidecars require explicit `--overwrite`. Use `--start`/`--end` source samples for a history-preserving selected export. `build-info` reports compiled source identity. JSON sessions use `libs/contracts/session.schema.json`; `--source` is authoritative for the renderer.

## Listen and compare

Use headphones for live monitoring. Open Audio devices, explicitly select your input/output, then enable monitoring. A reported buffer period is not measured round-trip latency. Start with a WAV: stages begin bypassed, enable an effect, select a passage and freeze RMS match before switching Dry/Processed. Raw residual is wet minus dry; matched residual includes the displayed correction gain. Neither isolates distortion. Output safety guarding affects monitor playback, not exported analytical audio.

The streaming path supports WAV up to 2 GiB/two hours; desktop inspection keeps a bounded window with full source-history processing and background replay. The eager analysis decoder remains capped at 256 MiB. Integer delay compensation does not remove frequency-dependent phase. RMS is not perceptual loudness and sample peak is not true peak. JUCE distribution licensing, signing and clean-machine qualification are required before public release.

The optional assistant uses actual native measurements and rendered previews. Its offline rules baseline supports bounded level requests; unsupported requests abstain. Provider-backed operation requires explicit consent, configured model/pricing and a cumulative budget. No live-model quality claim follows from protocol tests. See `services/audio-assistant/README.md` and `docs/assistant/`.

## Project memory and workflow

Start at `delivery/brain.md` for the compact current state. The complete original plan is preserved in `docs/memory/implementation-plan.md`; dependency and requirement manifests retain unfinished work. The orchestrator gives isolated workers only their API, relevant specification sections, owned paths and acceptance checks. Independent review findings become regression checks. Worker worktrees and downloaded tools are ignored by Git.

See `docs/learning/00-start-here.md` for the learning tour, `docs/distribution/development.md` for private packages and install tools, and `qualification/` for device/human protocols. Public implementation PRs #1–#3 are merged after independent review and Windows CI; integration PR #4 records the final independent review, exact-head checks and merge state. No GitHub Release or deployment has occurred; unsigned executable publication remains gated.

Recovery and escalation: `docs/runbooks.md`. Actual product-source mutation campaigns exercise gain smoothing, session-version rejection and assistant authorization; see `evals/README.md`.
