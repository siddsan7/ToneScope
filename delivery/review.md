# Independent development review

Separate worker contexts reviewed the core/analysis/CLI and desktop integration. These are agent engineering reviews, not human listening, device or accessibility qualification. Implementation PRs are public. No GitHub Release or production qualification is claimed.

Findings addressed in integration:

- One-frame inspect reported zero via a comparison API requiring two frames: use direct metering, add regression.
- Audio and evidence-sidecar overwrite protection differed: protect both paths; explicit complete audio/error behavior retained for a sidecar-publication failure.
- Hashing after render could attribute changed source bytes: hash before decode, verify source remains unchanged before publication.
- Stereo averaged before FFT could cancel opposite phase channels: transform independently and aggregate RMS bin magnitude; native anti-phase regression.
- Throwing validation in device callback: add finite/range/order-checked noexcept setter, retain prior state on rejection; zero-allocation rejection regression.
- UTF-8 Windows paths: use Unicode filesystem stream paths and wide CLI arguments; runtime regression required against final binary.
- Stale renders playable/exportable after failed source/settings change: require current rendered revision, stop monitoring for imports.
- Desktop session shape drift: one shared strict loader with closed keys and typed UI fields; consistent optional defaults.
- Out-of-domain float dry reference differed from Engine clamp: apply identical +/-16 ingress policy before reference trim and report clamp count.

Remaining development limitations are recorded in `progress.json` and `docs/design.md`; no review grants production release approval.

Further independent agent reviews cover exact-head PR1–3 and PR4 integration. Concrete fixes include low-rate preparation, signed interval overflow, phase-compensated crossover, concurrent publication, pinned SDK selection, deep Unicode paths, rollback identity/reparse ancestry, versioned assistant A/B routing, dedicated report validation, stale development evidence, admission/retention and bounded native baseline state. Actual source mutants exercise smoothing/version/authorization guards. Scope findings and rerun logs are retained under `artifacts/integration-review/`; PR comments record exact reviewed heads. Final merging requires passing exact-head Windows/Linux checks. These remain development reviews, not physical/human/live-model qualifications.

Visibility/publication review: GitHub confirms the repository and PRs are public. Earlier wording calling them private was incorrect. The generic CI upload also included unsigned executable bundles; task-created bundles were preserved with hashes locally and removed from public Actions artifacts. CI now allowlists report/source/synthetic evidence and excludes package/broker staging and executable archives. No repository visibility change or GitHub Release was performed.
