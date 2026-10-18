# ToneScope

A Windows guitar-effects workbench: select a passage, listen, adjust, and verify. C++20 hosts the audio engine, generated Faust kernels supply compressor/EQ/drive algorithms, and a bundled React/shadcn interface presents the microscope. Core audio runs offline.

**Status: development integration, not a qualified release.** Implemented software includes bounded streaming WAV rendering, persistent dry capture/recovery, 1x/2x/4x drive, phase-correct multiband compression, same-band audition, aligned comparison/residual, undo, independent numerical evaluations, and private development packaging. Long-file desktop transport, measured dynamics UI and native assistant preview integration are being verified. See `delivery/brain.md` and `delivery/progress.json` for current state and qualification limits.

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

The streaming path supports WAV up to 2 GiB/two hours; bounded desktop inspection and playback are under final integration. The eager analysis decoder remains capped at 256 MiB. Integer delay compensation does not remove frequency-dependent phase. RMS is not perceptual loudness and sample peak is not true peak. JUCE distribution licensing, signing and clean-machine qualification are required before public release.

The optional assistant uses actual native measurements and rendered previews. Its offline rules baseline supports bounded level requests; unsupported requests abstain. Provider-backed operation requires explicit consent, configured model/pricing and a cumulative budget. No live-model quality claim follows from protocol tests. See `services/audio-assistant/README.md` and `docs/assistant/`.

## Project memory and workflow

Start at `delivery/brain.md` for the compact current state. The complete original plan is preserved in `docs/memory/implementation-plan.md`; dependency and requirement manifests retain unfinished work. The orchestrator gives isolated workers only their API, relevant specification sections, owned paths and acceptance checks. Independent review findings become regression checks. Worker worktrees and downloaded tools are ignored by Git.

See `docs/learning/00-start-here.md` for the learning tour, `docs/distribution/development.md` for private packages and install tools, and `qualification/` for device/human protocols. Private PRs #1–#3 are merged after independent review and Windows CI; integration PR #4 remains a draft until final review and checks. No public distribution or deployment has occurred.
