# Private demo on this Windows system

Double-click **Open ToneScope.cmd** in the repository root. It verifies the installed package before opening the normal app. No build command is needed. PowerShell 7 (`pwsh`) must remain installed. To make a Desktop shortcut, right-click the launcher in File Explorer and use **Show more options → Send to → Desktop (create shortcut)**. Keep the repository and `artifacts/demo-installed` folder in place. Moving the repository together preserves relative paths; deleting the installed artifacts breaks the launcher.

The current private version is `0.1.0-demo-pr8-1c32a38`. Its executable is:

```text
artifacts/demo-installed/versions/0.1.0-demo-pr8-1c32a38/bin/ToneScope.exe
```

You can open that EXE directly or pin it to Start. Direct EXE launch does not perform the launcher's hash verification. The normal singleton/recovery state applies: if ToneScope is already open, use its existing window. Isolated test windows do not change that identity.

## Prepare a recording

1. Open the launcher. Import `artifacts/demo-pr8-1c32a38/listening/original-2.wav`. Check recovered settings before recording.
2. Select 0–8 seconds. Bypass EQ, drive, and multiband. Enable full-band compression: threshold −30 dB, ratio 4:1, attack 10 ms, release 150 ms, knee 6 dB; keep other gains neutral.
3. Use a comfortable playback level. Select an output under Audio devices if necessary. Automated checks have not qualified physical output/listening. Live monitoring is unnecessary for this file demo.
4. Freeze RMS match and show its displayed gain when comparing Dry/Processed. Freeze again after changing comparison conditions.
5. Mark separate soft/hard passages from their actual measured dry RMS; do not assume the first half is softer. If evidence is unavailable, show that state or omit the segment. Never invent values.
6. Rehearse keyboard focus, enlarged text, and actual local speech availability for OHLA. Pause playback before speech. Choose the unavailable script branch when needed. Speech doubles do not establish audible voice or Narrator behavior.
7. Open `artifacts/demo-pr8-1c32a38/listening/index.html` for attributed audio, plots, and renderer identity. Keep the folder together. Browser players do not provide sample-aligned A/B; use the desktop comparison for that workflow.
8. Record captions and the binary identity using [the scripts](walkthrough.md). No video has been recorded by this task. Keep the audio/page available as a fallback.

## Evidence and claims

The binary was compiled from clean merged commit `1c32a38875ebf08d81b8e0f2bc5f95233b06cc0d`, including PR #8's offline startup fixes. Its compiled identity is recorded in `artifacts/demo-pr8-1c32a38/build-info.json`, the package's `build-info.json`, and the listening report. This documentation refresh postdates that clean binary snapshot. The previous installed version remains available for rollback.

| Implemented; consult this build's results for verification | Not established |
|---|---|
| Persistent Faust compressor; defined curve/timing checks | Whole chain authored in Faust; Chaos hardware performance |
| RMS-matched public guitar regression examples | Equal perceived loudness, preferred sound, unseen musical generalization |
| Native summary data, unavailable states, keyboard/speech routing checks | Human accessibility qualification, Narrator compatibility, audible speech on every machine |
| Offline rules proposal/preview/apply/undo | Real model effectiveness, generated Faust, arbitrary tonal understanding |
| Verified private package and isolated startup/UI checks | Signed public release, clean-machine compatibility, physical latency/soak qualification |

The desktop requires a rules broker with `live_enabled=false` and writes `TONESCOPE_ENABLE_LIVE=0` to its private configuration. These demos require no provider keys or paid calls. Blocked model arms remain blocked. Historical 24/24 level and 16/16 compression rules results describe frozen development tasks, not model or holdout performance.

Fresh results and hashes: `artifacts/demo-pr8-1c32a38/verification.json`. Scope: [delivery record](../../delivery/demo-pr8-refresh.md). Failed attempts remain in separate logs. Numerical limits, frozen corpora, CI workflows, and existing product checks remain unchanged. [Post-merge CI passed](https://github.com/siddsan7/ToneScope/actions/runs/39350998442) on the exact compiled commit. Fresh local installed-package and normal launcher checks also passed. The historical intermittent assistant timeout remains unconfirmed; these passes do not establish that it is eliminated.

## Reinstall

Private ZIP: `artifacts/demo-pr8-1c32a38/ToneScope-0.1.0-demo-pr8-1c32a38-win64.zip`. Extract to a new directory, verify with its `tools/verify-package.ps1`, then run `scripts/install-dev.ps1 -PackageRoot <extracted ToneScope-dev> -InstallRoot artifacts/demo-installed`. The installer refuses version replacement. Keep the version directory and `active.json` together. Use the existing installer's `-ActivateVersion` option for another verified installed version; the launcher follows it. Do not point it at an arbitrary EXE.

This is an unsigned private build with the documented VC++/WebView2 prerequisites. The optional assistant requires Node 24 on PATH. This task makes no system-folder installation, registry changes, public upload, paid call, merge, or deployment.


For this fresh build, use original-2.wav: its 0–8 second compression render has a measured RMS correction of +6.08 dB, compared with +0.37 dB for original-1.wav. This selects a more active compressor example by signal evidence, not a listening judgment. Measured one-second cue windows: soft 5–6 s (dry RMS −27.98 dBFS); hard 0–1 s (−22.73 dBFS). Mark these, then restore the 0–8 s selection. The cue file is `artifacts/demo-pr8-1c32a38/passage-cues.json`; the desktop's current measurements remain authoritative. The unprocessed contrast is about 5.25 dB. Do not claim attack preservation or a preferred musical result from these numbers.
