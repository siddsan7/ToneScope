# ToneScope

A native Windows guitar-effects workbench: select a passage, listen, adjust, and verify. C++20 hosts audio and interaction; a pinned Faust-generated waveshaper supplies the nonlinear stage. The audio core runs without the UI or any cloud service.

**Status: development build, not D2/audio 1.0.** Implemented: bounded WAV import, dry/processed transport, explicit live monitoring and short dry capture, compressor/EQ/drive with bypass/order, cached waveform/spectrum, time selection, frozen RMS match, raw/matched residual, file-backed sessions, float WAV export and headless evaluation. See `docs/design.md` and `delivery/progress.json` for exact limits. No device timing, listening, accessibility or production qualification is implied.

## Build on Windows x64

Visual Studio 2022 with Desktop C++, Windows SDK, Python 3.12 and Git are required.

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

Evaluations return 0 for the executed suite passing, 1 for failure and 2 for blocked infrastructure/required qualification. DSP qualification remains blocked even when implemented numerical cases pass. Render output is float32 WAV with a hash manifest; existing WAVs or sidecars require explicit `--overwrite`. JSON sessions use `libs/contracts/session.schema.json`. `--source` is authoritative for headless rendering; the saved `source` field is a UI reference.

## Listen and compare

Use headphones for live monitoring. Open Audio devices, explicitly select your input/output, then enable monitoring. A reported buffer period is not measured round-trip latency. Start with a WAV: stages begin bypassed, enable an effect, select a passage and freeze RMS match before switching Dry/Processed. Raw residual is wet minus dry; matched residual includes the displayed correction gain. Neither isolates distortion. Output safety guarding affects monitor playback, not exported analytical audio.

Current UI files/captures are capped at 120 seconds; file import also caps at 100 MiB. The headless WAV decoder caps at 256 MiB. Drive is 1x, with unqualified aliasing. Streaming long files, oversampling, frequency-band audition, multiband processing, full recovery/undo, qualified packaging and D3 assistant remain planned. JUCE distribution licensing must be selected before public release; this project does not select or purchase a license for you.

## Project memory and workflow

Start at `delivery/brain.md` for the compact current state. The complete original plan is preserved in `docs/memory/implementation-plan.md`; dependency and requirement manifests retain unfinished work. The orchestrator gives isolated workers only their API, relevant specification sections, owned paths and acceptance checks. Independent review findings become regression checks. Worker worktrees and downloaded tools are ignored by Git.

See `docs/learning/00-start-here.md` for the learning tour and `qualification/` for tests requiring physical devices or human participation. Development source remains uncommitted for review; no merge, deployment or publication has been performed.
