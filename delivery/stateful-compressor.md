# Stateful compressor and presentation baseline

Goal: make the existing work easy to inspect and move the complete linked RMS
compressor into a persistent Faust graph without changing its behavior.

Scope: README, a reproducible local audio/plot showcase, the compressor graph and
host adapter, and independent regression tests. Paid model calls remain disabled.
No merge, deployment, or public executable release is part of this change.

Contracts: retain the current mean-channel-energy link, 10 ms detector, hard/soft
knee, attack/release smoothing in dB, makeup gain, zero compressor latency,
host control smoothing, bypass/reset behavior, and per-band state independence.
Faust owns the compressor state and audio gain application. C++ retains routing,
crossovers, validation, and smoothed control signals. Keep all numerical gates.

Acceptance: reproducible attributed examples and measured plots; unchanged
independent DSP gates; pinned Faust regeneration; native state/linking/reset and
allocation checks; Windows build and relevant integration/mutation checks.
Record actual results and limitations here after integration. A walkthrough
script is not a recorded video; software checks are not human listening or
hardware qualification.

Work ownership: root owns DSP/host integration and final verification. Isolated
workers own presentation files and the new public-API compressor regression
test. Root reviews all contributions before integration.

## Verified handoff

Implemented locally; no merge, deployment, public executable release, or paid
provider call. Independent worker review found no blocking compressor or
presentation issues. Its walkthrough clarification was integrated.

Windows build, pinned Faust regeneration, native 8/8, Python integration 40/40,
assistant 24/24, frontend 5/5 and both TypeScript checks pass. Independent
contracts 10/10, DSP 12/12, integration 7/7 and both public DI originals pass.
Actual smoothing/schema/assistant-authorization mutants are detected with passing
unmodified baselines. AI replay retains its blocked live case and passes the
development protocol checker. All existing numerical gates remain unchanged.

`artifacts/showcase/index.html` contains four attributed examples, three measured
plots, and eight PCM16 audition clips. All 199 recorded artifact hashes and HTML
references were verified. The first dry clip loaded and played to eight seconds
in the in-app browser. This is software playback, not a listening study.

An alternating four-run offline-render comparison retained the historical
baseline's identity and matched rendered samples exactly on the tested four-second
full-band and multiband fixtures. Timing includes process startup, hashing and
file IO; it does not establish callback CPU or hardware performance.

Detailed results and identities: ignored `artifacts/stateful-compressor/summary.json`.
Early failed attempts remain beside passing runs: sandbox local-loopback/temp
restrictions, and a build/evaluator overlap that locked the renderer executable.
The latter was corrected by finishing the build before running evaluators.

At this handoff, desktop screenshot and embedded UI startup were blocked. The
subsequent investigation identified an older packaged app holding the normal
singleton mutex. Hardware-free probes now use isolated identities and recovery
storage while preserving the production guard. Final startup and embedded UI
checks pass; see `delivery/desktop-startup.md` and its evidence summary.
Linux sanitizers, installer/package gates, hardware and human evaluations were
not rerun; no release qualification is claimed. The narration script is not a
recorded video. Next work: human narration/listening and the offline-capable AI
evaluation harness, followed by separately consented live-model execution.
