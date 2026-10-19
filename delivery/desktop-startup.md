# Desktop smoke isolation

Goal: make screenshot and embedded UI smoke runs pass while preserving the normal
single-instance guard, recovery state, and every existing assertion. Paid model
calls remain disabled. No merge, deployment or public release is authorized.

Verified cause: a responsive older packaged ToneScope process (PID 33096 during
diagnosis) owned `Global\juceAppLock_ToneScope`. Restricted process inspection hid
it. Tracing reached construction, the single-instance check, and shutdown without
application initialization. Win32 mutex creation reported already-exists and a
zero-time wait timed out. An assigned reviewer identified the owner with
`NtQueryMutant`. This was expected singleton behavior, not a compressor regression
or a proven Windows permission defect. The older app was left untouched.

Implementation: explicit hardware-free probes accept one validated 32-character
lowercase hex `--ui-test-instance` identifier. Normal launches always use the
original name. Probes retain the same JUCE singleton enforcement per identifier,
use a separate recovery namespace, and preserve private assistant storage.
Identity and startup routing share argument normalization, including quoted
flags. No JUCE dependency patch or temporary startup trace remains.

Checks: startup PNG/exit/timeout plus deliberately held same-instance rejection;
actual embedded commands, passage/GR measurements, offline assistant preview,
A/B, frozen RMS match, explicit Apply/undo; fonts, scaling and media checks;
normal recovery unchanged and older app still alive; malformed/duplicate/normal
identity regressions; occupied port refusal and failure-path environment restore.
CI runs the same startup and embedded helpers. Existing numerical gates and
embedded JavaScript assertions remain unchanged.

Commands: `scripts/test-startup.ps1 -CheckSingleton` and
`scripts/test-embedded.ps1 -Assistant`. The latter creates a deterministic
four-second fixture with a 20 dB soft/hard contrast. An explicit `-Source` with
`-Assistant` must satisfy the existing passage/headroom assertions; arbitrary
musical material is not a substitute for that fixture.

Current evidence lives under ignored `artifacts/desktop-startup/` and
`artifacts/frontend-native/`. Consult `artifacts/desktop-startup/summary.json` for
final executed checks and binary identities. These are software checks, not
hardware, human accessibility/listening or live-model qualification.

Final local checks pass: Windows build, native 9/9, Python 40/40 (no skips),
independent DSP 12/12, six launch guard regressions, quoted-flag screenshot with
same-identity rejection, and the full embedded/offline-assistant workflow. Both
smokes bind to the same final executable hash. The older app stayed alive and
its recovery file hash stayed unchanged. Independent review has no remaining
blocking findings. Remote CI, Linux sanitizers and installer/package gates were
not rerun; merge/release review is still required.

Remaining agreed work is recorded in `delivery/progress.json`: the real AI level
evaluation harness, bound compression measurements/benchmark, accessible summary
prototype, and recorded/captioned walkthrough. Existing release and external
qualification gates remain separate.
