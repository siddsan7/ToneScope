# ToneScope working context

Read this first; load only the relevant API/spec/task afterward. Full specification: `docs/memory/implementation-plan.md`. This brain is working state, not release evidence. Historical states are retained in Git.

## Goal and constraints
Complete the Windows effects engine/audio microscope and separately gated assistant, with recruiter-reviewable PR history and project-specific independent evaluations. User confirmed dark React/shadcn embedded inside native JUCE, preserving C++ audio. Apple design/motion principles apply; Free Faces fonts are locally licensed. Root orchestrates; bounded agents use isolated worktrees and concise task context. Merges require independent review and exact-head CI. No public release or paid provider calls are authorized by development work.

## Delivery state
Private GitHub `siddsan7/ToneScope`. Foundation PR1 and DSP PR2 merged after independent agent review and Windows CI. PR3 (evaluation + required streaming/latency contracts) exact head20a99b2 has both CI runs passing; independent exact-composition review pending. PR4 integration draft includes frontend/service/streaming; first CI caught bridge compile error, fixed in integrated3e2e714; final push/review/CI pending. Root branch `codex/delivery-orchestration`.

Integrated commits include native state/capture3e2e714, Faust kernels5f08ee1, dynamics APIs641cf1d, accessibility/provenance50a71bc and packagingbc1413c. New frontend manual-passage UI/MicroscopeIntegration.inc and progress updates are uncommitted pending native hook integration. Do not reset them.

## Current implementation
- C++20/MSVC19.44, JUCE9.0.4 exact3fb5cbc, Faust2.88.0; versions/hashes in dependencies.lock.json. Real WebView2 SDK1.0.3485.44 archive pinned and exact cache path forced (wildcard lookup bypass fixed).
- Actual generated Faust compressor, RBJ EQ coefficients/biquads and tanh execute in Engine. Host owns scheduling, smoothing, crossovers/resampling and surrounding drive filters. Quality1x/2x/4x; 2x/4x drive declares32 source samples pure delay; phase is still frequency dependent. Compensated LR4 three-band compressor has independent linked detectors.
- Bounded WAV CLI supports2GiB/two hours. Explicit selected export processes source history from0 then compensates pure delay, including EOF zero flush. Canonical graph hash uses actual native values. Concurrent publication reserves both destinations and publishes without replacement unless --overwrite. Two-step audio/manifest can leave complete audio if sidecar fails.
- Native persistent dry capture has fixed1MiB queue/background disk writer, overflow/incomplete recovery, atomic session snapshots, strict schema1 migration, verified relocation and bounded whole-patch undo. Desktop raw export excludes band/match/monitor transforms.
- React/shadcn/Radix +Motion dark instrument UI is embedded and compiled. Space Grotesk/Commit Mono load from bundled OFL assets. Native allowlist/local resources/CSP protect bridge. 200% text, forced-colors and reduced-motion software checks passed; Narrator/human checks remain external.
- Assistant service: offline RulesProvider default, typed bounded tools, actual native candidate renders, authenticated loopback broker, stale/hash/forgery/cancel gates, separate redacted history. Dormant Gateway adapter uses real SDK with explicit opt-in/model/pricing/token/cumulative-currency gates; no live calls made. Native client/preview/explicit apply integration is being finished.
- Dynamics library: renderWithDynamics preserves exact rendered samples, records actual overall/per-band GR; comparePassages reports explicit manual soft/hard RMS/peak/crest/contrast and available full-history envelope crossings. No onset/perceptual claims.

## Active isolated ownership
- `.worktrees/native-state`, native_state_delivery: Main.cpp, FilePlayback/streaming inspection helpers and transport tests. Long-file metadata/absolute timeline, <=10s bounded inspection, full-history processing, exact entire-selection metrics, worker-resampled playback ring and streaming export. Also owns WebFrontend.inc snapshot offsets, actual streamGR and guarded MicroscopeIntegration hooks. Root will wire short renderWithDynamics afterward. --source launch added for real UI tests.
- `.worktrees/assistant`, assistant_delivery: new AssistantBridge.h/AssistantIntegration.inc and nativehelper test, service host ready-file handshake. Actual1x protocol passed; investigating2x native_cli_failed regression. Persistent private history and cryptographic capability; Node24 optional. Prefers bin/assistant/host.mjs then dev TS entry. Root must add CMake assistant test/link dependencies when handed off.
- integration_review: exact PR3 composition approval first; packaging369a067 security review next. Read-only.
- Root owns frontend TSX/CSS, MicroscopeIntegration.inc, CMake/CI/contracts/provenance, integration and final verification. No overlapping root Main edits until worker handoff.

## Verification and commands
Intermediate evidence only: native CTest3/3; Python32/32 zero skips in `.tools/provenance-python-required.log`; assistant19/19 zero skips (sandbox denied loopback first, escalated rerun passed, failure retained); frontend5/5; independent Faust-integrated DSP12/12; contracts10/10. Nine alias fixtures improved18.55–26.32dB against converged independent reference, not universal quality.
Actual native UI probe `tests/ui/embedded-native.mjs`: ToneScope --demo --web-ui-test --web-debug-port9337; proved measured waveform/spectrum, valid parameter, invalid rejection, native undo, font loading,200% scaling/media. Evidence `artifacts/frontend-native/`. Native test process50220 may still run; verify executable path before stopping it for rebuild. Test process opens no audio hardware.
Build `.tools/python/cmake/data/bin/cmake.exe --build --preset windows-dev -- /m:1 /nr:false`; CTest corresponding preset. CLI build-info embeds source/commit/compiler/dependency identities; final clean build is mandatory. Evaluate `python evals/run.py --cli <exe> --suite contracts|dsp|integration --output <freshdir>`. AI-replay development is protocol baseline, not model qualification. Python native assistant env TONESCOPE_ASSISTANT_RUNTIME must be service DIRECTORY, not service.ts; CI sets REQUIRE_NATIVE_TESTS=1 so missing runtime fails instead of skips.

## Next actions
1. Complete native long-file and assistant handoffs; resolve helper failures, integrate and compile actual WebView app. Add required native test targets.
2. Wire actual short-file GR timeline and microscope hooks, finish source-time UI mapping, test manual passage flow and real assistant preview/apply/undo in embedded app.
3. Independently review new native integrations and packaging; merge PR3 after approval; update PR4 body around final scope and push.
4. Run final clean-head native/frontend/service/eval/sanitizer CI, retained failed artifacts, rebundle latest broker, verify private ZIP and versioned install tests. Link source/runtime/package identities; update progress and compact brain.

## Genuine external qualification
Physical Windows device lifecycle/callback timing/round-trip/soak; licensed musical corpus and independently owned sequestered holdout; human listening/Narrator/mixed-DPI/accessibility; JUCE distribution route/notices approval; signing identity and clean-machine qualification; explicit priced provider-backed model evaluation. Never substitute mocks/protocol regressions for these. Software integration above is still active, not an external blocker.
