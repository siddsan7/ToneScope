# Public musical DI regression

[Guitar-TECHS](https://guitar-techs.github.io/) records guitar-output DI separately
from amplified/microphone signals. Its authors and the
[official Zenodo record](https://zenodo.org/records/14963133) license the data
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Attribution: Hegel Pedroza and colleagues, *Guitar-TECHS*, ICASSP 2025,
DOI 10.1109/ICASSP49660.2025.10887996. Full attribution/URLs are frozen in
`evals/datasets/guitar-techs-public.json` and accompany generated reports.

The P3 musical archive is 129,505,089 bytes. Its published MD5 is
`071ba80aecf00f4a31fbd167b3f22198`; verified SHA256 is
`033489e22600751fb5a1633e7d856b901c6782e0486fa02135e830780d9dbfe2`.
Two smallest direct-input originals, 11 and 08, were selected by bytes/path before
outcomes and frozen with member CRC/SHA, dimensions and player/performance groups.
Full 21.125 s and 27.333 s recordings passed native inspection, an independent exact
bypass null, and finite/correct-shape 4x drive/compressor smoke checks. Those checks
do not measure preferred tone or perceptual quality.

```powershell
python scripts/acquire-public-corpus.py --output .tools/public-corpus/P3_music.zip
python evals/public_corpus.py --archive .tools/public-corpus/P3_music.zip --cli build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe --output artifacts/public-corpus-new
```

Acquisition is capped at the frozen byte count/200 MB and 900 seconds between
buffered reads, with <=30 s socket waits. It validates length and both hashes,
preserves incomplete attempts and never overwrites an existing unverified file.
The offline runner never downloads: it requires verified archive/member bytes,
checks all ZIP paths/types/duplicates and a 1 GiB uncompressed cap, flattens only the
two named files, refuses an existing output folder and records actual CLI
`build-info` plus raw commands/hashes. Re-encoded float32 audio preserves rate,
channels and gain; all processed variants retain their original performance group.

Nightly CI runs this public regression after the usual software gates. PRs test
acquisition bounds/integrity using fixtures without downloading the musical data.
CI evidence includes attribution, transform notes and synthetic/CC-licensed WAVs;
executable/ZIP distribution remains separately gated.

This is **public inspectable regression data**, all within player P3. It is neither
an unseen holdout nor a representative musical benchmark. Independent holdout
custody, human listening/accessibility, physical devices and provider-backed
model evaluation remain required for their respective qualification claims.
