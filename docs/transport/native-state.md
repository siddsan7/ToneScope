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

Desktop sources above the legacy 100 MiB / 120-second cache threshold use a
bounded streaming path up to the reader's 2 GiB / two-hour limits. Whole-source
metadata, seeking and selection remain on the full timeline. Waveform/FFT and
sample payloads retain at most ten seconds or 1,048,576 frames, plus the known
latency lookahead; the displayed window carries absolute source-frame offsets.
RMS matching and residual metrics accumulate over the entire selected interval,
not just that visible cache. Narrow or move the numeric selection to inspect a
different passage. The UI labels the cached waveform interval separately.

Every seek reconstructs engine and identical audition-filter state from source
frame zero on a file worker. Progress is explicit; there is no approximate
short pre-roll. A 2 MiB fixed stereo dry/wet packet queue feeds playback after
background linear resampling to the device rate. The audio callback only drains
prepared samples, mixes the chosen comparison mode, applies declared boundary
fades and the monitoring guard, and updates atomics. Source verification/read
failure or starvation stops playback and applies a bounded fade to silence;
there is no substitute source. Loop restart repeats exact preparation and may
contain a preparation gap, rather than claiming seamless large-file loops.

Streamed full/selected export processes from source zero into a bounded WAV
writer on the file worker. Export uses the explicitly recorded engine-output
interval, without audition filters, level matching or monitoring guard. SHA256
is verified before/after inspection and export and before playback preparation;
worker processing also checks source size/modification time periodically and
reader failures remain fatal. Escape cancels pending streamed work. Source and
render revision gates reject stale inspection publication. The inspection offset is explicit for assistant/manual-passage baseline consumers.
Verified cropped candidate audition uses the same bounded ring with an absolute
source timeline offset; proposal application remains a separate parameter transaction.
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
exports the full source; Ctrl+Shift+E exports the selection; Escape pauses; Space toggles playback. Native bridge commands `undo`,
`redo`, and `recover` expose the same actions and snapshot flags `canUndo` and
`canRedo`. Topology edits stop monitoring and prepare outside the callback.

Export retains an independent full-band processed payload before frequency
filters. Cache hits retain that payload. The output is float32 on the full-source
engine-output timeline (including engine latency and unavailable latency tail),
without audition filters, RMS match, boundary fades or monitoring guard. Evidence
records selection/filter settings and comparison alignment separately. It does
not claim an aligned or latency-trimmed exported waveform.

`--source <absolute.wav>` loads an explicit startup source and reports invalid/missing paths. `--web-ui-test` starts the real bundled browser without opening audio hardware.
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

Long-file regression coverage generates a 121-second fixture using fixed-size
scratch storage, checks inspection and playback beyond the former duration cap,
whole-selection RMS with a ten-second cache, selected streaming export, worker
cancellation, exact nonlinear seek history, identical branch filter history and
known latency alignment against the authoritative full render. The callback
boundary remains subject to integrated application/device verification.
The transport admits at most one active/retiring playback worker. Rapid seek or
candidate requests replace one deferred message-thread start request until the
old worker signals completion; they cannot accumulate unbounded worker queues.
Candidate transport independently verifies file SHA256/rate and maps its cropped
frame zero to the original absolute selection frame. The native regression suite
also checks resampling, absolute candidate cursor/EOF and verification rejection.
Gain-reduction histories contain actual Engine state sampled at 512-frame block
ends with explicit raw DSP source positions, including per-band reductions.
Bounded windows also preserve the linked 10 ms mean-squared envelope state from
source zero. FileInspection carries dryInitialEnvelopeEnergy and
wetInitialEnvelopeEnergy immediately before cache sample zero, after the actual
branch audition filters. Wet energy is on the raw DSP timeline; a consumer that
aligns wet by 32 samples must advance the cached wet prefix from that state.
The optional processFileRange checkpoint observes the processed prefix before
range gating, adds only two energy accumulators, and stops its extra energy
loop once captured. Playback and export do not request or compute this state.
Stereo late-window, filter-history, 32-sample continuation and worker-block-edge
regressions compare these states against independent full-source recurrences.
