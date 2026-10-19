# ToneScope listening bench

ToneScope connects an audible change to an inspectable measurement. Select a passage, adjust an effect, freeze RMS match, and compare. The generated local page lets a reviewer hear four examples without building the desktop app. It includes settings, attribution, three measured plots, and the exact renderer identity.

## Generate the baseline

Use Python and an existing native CLI. No Python packages are required. Download the pinned public archive once with the existing bounded acquisition tool:

```powershell
python scripts/acquire-public-corpus.py --output .tools/public-corpus/P3_music.zip
python scripts/build-showcase.py --archive .tools/public-corpus/P3_music.zip --cli build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe --output artifacts/showcase
Start-Process artifacts/showcase/index.html
```

The generator is offline. It refuses an existing output directory and fails if an existing numerical check fails. Choose a new output directory for each binary. The complete run takes longer than audio rendering because it also executes the existing multi-rate alias reference checks. Keep the output folder together when sharing it for review; there is no executable in the generated folder. Publication still requires the project's review gate.

`report.json` binds the audio and plots to SHA-256 hashes, actual CLI `build-info`, source selections, parameters, and measured gains. Raw command records and independent numerical results remain under `measurements/`. A generated baseline describes its recorded binary, which may predate the current source. Rebuild the CLI and rerun after the compressor migration before claiming evidence for that implementation.

## What to inspect

The page has two compressor excerpts (0–8 s) and two 4x drive excerpts (8–16 s), drawn from the two frozen Guitar-TECHS DI recordings. They remain one player's public regression material. They are not four independent performances or a holdout.

The compressor uses threshold −30 dB, ratio 4:1, attack 10 ms, release 150 ms, and knee 6 dB. The drive uses 18 dB drive, 5 kHz tone, and 4x oversampling. Native selection rendering reconstructs source history. The raw float32 WAV retains the engine's analytical output. Separate PCM16 audition files match wet RMS to dry and apply the same extra headroom gain to both. The page reports both gains. This prevents a simple level increase from dominating the comparison, but does not establish equal perceived loudness. Browser players do not provide sample-aligned A/B; use the desktop comparison for that workflow.

The plots reuse existing independent checks:

- **Compressor curve:** three settled DC levels, 4:1 hard knee, measured output against the independent transfer formula. Straight segments connect measured points; they are not a dense sweep.
- **Compressor timing:** a low/high/low DC signal at 48 kHz against the 10 ms energy detector and attack/release reference. The underlying checks also run at 44.1 and 96 kHz.
- **Oversampling:** 1x/2x/4x periodic waveform error against the converged high-rate reference at three frequencies at 48 kHz. The underlying checks also run at 44.1 and 96 kHz. Error includes finite resampler/tone-filter differences; it is not isolated alias energy or a universal sound-quality score.

`NOTICE.txt` contains Guitar-TECHS attribution, source and CC BY 4.0 links, and explicit transformation notes. Keep it with the audio. See [the corpus protocol](../evaluation/public-corpus.md).

No listening study, accessibility study, hardware test, paid model call, or narrated video follows from generating this page. [walkthrough.md](walkthrough.md) is a recording script for the next review step.
