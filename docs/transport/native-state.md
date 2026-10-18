# Native transport and persistent state

The callback copies dry device samples into a preallocated stereo SPSC queue
(256 x 512 frames, about 1 MiB). A dedicated file thread writes float32 WAV.
The saved dry tap is finite-sanitized device input **before** the +/-16 ingress
clamp and input trim; replay therefore applies the chosen trim once. Live dry
monitoring uses a bypass Engine with identical ingress clamp and 15 ms trim
smoothing. Monitoring guard interventions remain outside saved dry samples.

Capture stops at the earlier of 2 GiB (including RIFF header) or two hours.
Queue overflow, device interruption and disk faults stop recording and mark the
take incomplete. The retained prefix is preserved, never presented as a complete
take. `*.capture.json` records completeness, persisted frames and fault category.
Complete takes are loaded as real file-backed sources and can be saved/reopened
with SHA256-verified sessions. Files reside under the user's application-data
`ToneScope/recovery/takes` directory and remain local.

The cached desktop microscope still accepts at most 100 MiB / 120 seconds. A
longer dry take is preserved on disk but cannot yet be inspected/replayed in the
desktop. The core streaming reader/writer and CLI support larger assets; this
change does not claim full streaming desktop playback or remove its cache cap.

Sessions save through a validated temporary file and atomic replacement. Failed
validation/replacement preserves the prior snapshot. Delayed recovery snapshots
are stored only for file-backed, SHA256-known sources. Ctrl+Shift+R restores the
last recovery session without enabling monitoring. If an interrupted take is newer than the session, it
recovers the latest interrupted capture by copying only complete aligned frames
from the exact known float32 stereo writer format. Recovery preserves the
original and labels the new file `.recovered-incomplete.wav`. Power-loss
persistence is not guaranteed by these OS-level atomic replacement checks.

Schema 1 is the sole known historical schema: migration is explicitly identity.
Unknown versions fail rather than guessing. Missing-source recovery prompts for
the original WAV and verifies the saved digest before applying any session
controls. A session lacking a digest cannot automatically relocate its source.

Parameter history stores up to 128 whole patches. Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y
undo/redo; Ctrl+O imports; Ctrl+Shift+O opens a session; Ctrl+S saves; Ctrl+E
exports; Escape pauses; Space toggles playback. Native bridge commands `undo`,
`redo`, and `recover` expose the same actions and snapshot flags `canUndo` and
`canRedo`. Topology edits stop monitoring and prepare outside the callback.

Export retains an independent full-band processed payload before frequency
filters. Cache hits retain that payload. The output is float32 on the full-source
engine-output timeline (including engine latency and unavailable latency tail),
without audition filters, RMS match, boundary fades or monitoring guard. Evidence
records selection/filter settings and comparison alignment separately. It does
not claim an aligned or latency-trimmed exported waveform.

`--web-ui-test` starts the real bundled browser without opening audio hardware.
For local bridge tests only, add `--web-debug-port 9222` to request loopback
WebView2 debugging; the port flag has no effect without `--web-ui-test`.

Verification: `tests/native/transport_tests.cpp` exercises actual disk capture
readback, queue overflow, duration/disk failure, interrupted-file recovery,
atomic-state preservation, schema rejection, bounded whole-patch history,
float32 export/filter separation, production export/cache protocol guards, and live dry calibration. Device, human
listening, hardware timing, accessibility and power-loss qualification remain
external and unperformed. Full desktop end-to-end source relocation and browser
bridge tests are separate from these native helper checks.

Scoped verification used MSVC directly with the pinned core sources and read-only
JUCE module objects from the existing Release build. Main.cpp compiled with
WebView2 disabled for this scoped check; the integrated root build must verify
the actual embedded browser and assistant integration. The isolated CMake
configure passed; its full project build was not used as passing evidence.
