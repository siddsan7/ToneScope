# ToneScope working context

## Active continuation (supersedes historical delivery notes below)
User explicitly requested completion through genuine external blockers, production PR push/review/merge workflow, rigorous project-specific DSP/AI evaluation, and a dark React/shadcn frontend embedded in the native app (architecture confirmed).

Foundation PR #1 and exact-head DSP PR #2 are merged after independent agent review and passing Windows CI. Main checkout `codex/delivery-orchestration` integrates DSP, streaming CLI, React frontend, hardened evaluations and the optional assistant service. Integration is ongoing; this is not a qualified release. Detailed historical notes below describe an earlier baseline and are superseded by this section.

Active isolated work, with minimal task-specific context:
- `.worktrees/assistant`, `codex/audio-assistant`: service committed ab58b909; native AssistantBridge.h/AssistantIntegration.inc connection next. Offline rules by default, real native candidate rendering; dormant metered opt-in Gateway adapter; no paid calls made.
- `.worktrees/native-state`, `codex/native-state-transport`: Main.cpp, persistent background dry capture, raw export separated from audition, recovery, undo/redo and assistant lifecycle hooks. Compiling before handoff.
- Read-only integration reviewer: concurrent export publication, exact WebView2 dependency pin, integration validation. Found race and SDK pin bypass; fixes pending verification.
- Orchestrator: shared contracts, bounded streaming CLI, CMake/CI, PR integration and final evidence. No overlapping writer paths.
- Frozen completed workers: `.worktrees/dsp-next` head4aa4489 (merged PR2); `.worktrees/evaluation-next` headb6833a9 (evaluation PR pending); `.worktrees/frontend` headaa4dfb3 (integrated, embedded build pending).

Current root build session3054 compiles the actual embedded WebView2 frontend. Avoid editing native sources while compiling. CLI streaming/selection, exact processing history and atomic no-clobber publication are being verified. Pending SDK fix: explicitly force WebView2_root_dir to pinned NuGet directory; JUCE otherwise selects the first matching package/cache. Remaining software includes native assistant wiring, long-file desktop inspection, full accessibility/keyboard/device handling, packaging and final clean-head evidence. Do not label software work as external qualification.

Evaluation: independent EQ/comp timing/crossover/alias oracles, immutable grouped regression inventory, adversarial proposal graders, exact-source/runtime release evidence. Latest evaluator worker run31 Python tests, contracts10, DSP12, integration7 passed against integrated CLI. These are development evidence, not clean-final-commit release evidence. Nine fixed alias fixtures improved18.55–26.32dB; this bounded result is not a universal audio-quality claim. Service18 tests and frontend5 tests passed in worker contexts; integrated reruns required.

Approved additive Parameters API: int `oversampling=1`, bool `multiband=false`, `crossoverLowHz=200`, `crossoverHighHz=2000`; root updates schemas/loader/CLI when DSP head is ready. Analysis helpers are documented in worker handoff; positive latency aligns wet[n+latency] to dry[n]. Live paid model calls remain disabled without explicit consent and configured budget.

Read this first on resume. Load only the relevant contract, task and specification section afterward.

## Goal and acceptance
Build the native Windows effects engine/audio microscope specified in `docs/memory/implementation-plan.md`: D1, then D2, optional separately gated D3. A working development executable exists; the full plan is **not complete**. See `progress.json` for feature-level remaining work. Do not infer production readiness from passing development tests.

## Integrated state
- C++20/MSVC native JUCE desktop and headless renderer compile. Pinned JUCE/Faust/CMake in `dependencies.lock.json`; generated Faust tanh graph is actually used. Compressor/EQ and host filters remain authored C++.
- Desktop: import, transport/selection/loop, explicit live monitoring, bounded dry capture/replay, effects controls/order, cached waveform/stereo-energy FFT, frozen RMS match/raw and matched residual, strict file sessions/source digest checks, float export/evidence. Desktop file limit 100 MiB/120 s; core decoder 256 MiB. Drive is 1x. Default host/test rates 44.1/48/96 kHz.
- Shared API `libs/audio-engine/include/tonescope/Engine.h`; shared strict session loader `libs/session/include/tonescope/Session.h`. Processing thread owns DSP zones/state. Noexcept real-time setter retains valid state on rejection. UI publishes fixed snapshots. Full renders carry revision gates; invalid/new sources cannot export an old render.
- Frontend uses apple-look/apple-motion principles translated to Windows JUCE. Native synthetic offline snapshot: `artifacts/ui/desktop-final.png`; no device was opened by that smoke mode. Source screenshot invocation: `ToneScope.exe --demo --screenshot <absolute.png>`.

## Verification and review
Windows Release build passed; native CTest 1/1; Python tests 15/15; independent contracts 9/9 and integration 6/6; DSP 7 passed with required advanced qualification blocked. Faust source-to-generated drift check passed. AI suites correctly blocked. Evidence index: `progress.json`, raw suites under `artifacts/`, report `artifacts/report.html`. Tests include anti-phase stereo, allocation-free invalid real-time controls, Unicode paths, source digest mismatch, UI coercion and sidecar protection. Agent reviews and fixes: `review.md`.

No commit/merge/push/deployment/public release occurred. Exact binary hashes and dirty-source state are recorded. MSVC generated/precision-conversion warnings remain. A repeated evaluator run initially failed because existing evaluator-owned outputs were protected; its explicit overwrite fix was independently reviewed, and the failed summary is retained at `artifacts/integration/run-before-rerun-fix.json`. Dedicated no-clobber tests remain intact.

## Immediate concerns / next implementation
1. Complete bounded streaming and persistent dry takes, then transport/device fault/overflow/recovery cases. Live dry reference currently precedes trim; file analytical dry uses identical ingress clamp and trim. Match those live semantics before claiming full TS-005.
2. Add identical-branch frequency audition, envelopes/dynamics, oversampling and phase-correct three-band processing with independent response/timing/alias/phase references. Missing software remains planned, not disguised as an external blocker.
3. Finish undo, complete keyboard commands, high-contrast/scaling/Narrator behavior, source recovery/migrations and installer clean-machine workflows.
4. Implement D3 tools/service/UI/benchmarks only after stable session/preview contracts; no live paid provider without opt-in and configured budget.

## External qualification
Physical interface/laptop timing/lifecycle/soak, licensed DI corpus, human listening/accessibility participants, distribution licensing choice, signing and clean-machine qualification remain unavailable/unperformed. Never mark them passed from mocks. Local ZIP is an unqualified development bundle; release-check must reject missing evidence.

## Context/ownership workflow
Main orchestrator owns dependency DAG, shared contracts, integration and final evidence. Bounded workers use isolated `.worktrees/` with path ownership and `fork_turns=none`: task/API/relevant plan sections/acceptance only. Current workers are finished; their integrated fixes live in root. Keep full historical material in durable memory, update this compact brain after integration, and use a fresh reviewer context for substantive changes. Do not dump complete conversation history into new workers.
