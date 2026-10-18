# ToneScope interface and ownership

The primary interface is a dark React/shadcn instrument view embedded in native JUCE/WebView2. The original native controls remain the fallback if the browser runtime is unavailable. The C++ engine owns audio and analytical values; React receives versioned bounded snapshots and returns allowlisted typed commands. File and device actions use native choosers. Packaged resources/fonts are local, navigation is restricted, and the browser never receives broker credentials or arbitrary filesystem access.

## Instrument layout

The measured waveform and logarithmic frequency spectrum sit beside the signal chain and assistant tabs. Sage/amber labels and distinct trace styles identify dry/processed signals beyond color. Space Grotesk and Commit Mono were curated from Free Faces and bundled under OFL; component sources/licenses and upstream links are in `frontend/README.md`. Numeric entries accompany sliders, keyboard commands retain native transport behavior, and selection is expressed in absolute source time even when a long file uses a bounded inspection window.

Motion supports reduced motion; text can scale to200%, with forced-colors and contrast handling. Actual embedded software probes verify fonts, measured traces, parameter validation, undo, passage marks, assistant interactions and layout/media behavior. These are not human Narrator, mixed-DPI or usability findings. `artifacts/frontend-native/embedded.png` is an actual native embedded screenshot from the functional synthetic fixture, not a design mockup.

## Measured comparison

Every render reconstructs history from source frame zero. Stale revision results cannot publish current measurements or playback. Dry and wet use identical selected-band filters; compensated integer latency does not remove frequency-dependent phase. Frozen RMS matching is capped at12dB and does not alter exported samples. Raw/matched residuals are mathematical differences, not isolated distortion. Analytical samples and guarded monitor playback remain separate.

Manual soft/hard marks report RMS, sample peak, crest and contrast, plus available10–90% rise/90–10% decay crossings using full-history10ms energy. Missing crossings/silence remain explicit. Actual overall/per-band compressor reduction is recorded by the engine; snapshots retain at most512 actual paired observations and source positions. No fabricated transient detector or perceptual score is presented.

## Bounded ownership

The message thread owns controls/source/render lifetimes. Publishing immutable cached playback detaches the callback; callbacks never destroy shared pointers or perform file, JSON, FFT, model or logging work. Fixed command/capture/playback rings separate audio from workers. Continuous controls use the native noexcept realtime setter; topology/latency changes reconfigure while stopped. Long files expose full metadata and an inspection window no longer than ten seconds/1,048,576frames; processing and exact selection metrics include earlier history. Worker replay uses a bounded ring and explicit starvation/fault stop. Eager analysis retains a256MiB limit; streaming WAV supports2GiB/two hours.

Persistent dry capture is independent of monitor gain, with overflow/incomplete status and explicit recovery. Sessions validate strict schema1, source digests and typed UI fields; snapshots publish atomically and parameter patches undo as one transaction. Raw export excludes selected-band, match, fades and monitor guarding. Audio/sidecar publication reserves both destinations; two-step failure can leave complete audio without a sidecar and reports that failure.

## Optional assistant and diagnostics

The optional private Node broker has authenticated loopback access, bounded tools/admission/history/assets, independently verified native previews, revision binding and explicit Apply. Offline rules support measured level requests and abstain on unsupported tonal requests. Candidate/current-settings A/B uses frozen RMS matching without modifying the graph; Apply changes one patch and one Undo restores it. Missing runtime is an explicit unavailable state. Real model access remains dormant behind consent/model/pricing/currency gates.

Callback observations are opt-in and disabled by default. Timing bins, scoped misses, calibration and runtime event counters can be exported locally through a dedicated atomic JSON writer; review device identity before sharing. These observations do not certify hardware deadlines or round-trip latency. Recovery and escalation steps are in `runbooks.md`.

## Qualification limits

Physical device lifecycle/round-trip/soak, human listening/accessibility, independently licensed musical data/holdout, signing/licensing choices and clean-machine installation remain required. Linear monitor resampling and discrete transitions need listening/device qualification. No UI screenshot or synthetic numerical suite completes those gates. See `../qualification/`, `../delivery/progress.json` and the exact PR checks for the current delivery status.
