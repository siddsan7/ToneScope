# Opt-in callback timing probe

`CallbackProbe` is disabled by default. Its disabled RAII path reads one proven
lock-free boolean and never reads a clock or the device sample rate. When enabled,
it records a steady-clock scope in the native audio callback. On this MSVC build
that clock uses QPC. Storage is fixed (272 bytes in the checked Windows x64 build),
with 24 histogram bins and lock-free counters. Recording allocates no memory and
performs no locking, filesystem access, logging or UI work.

The measured scope begins at the enabled RAII entry timestamp and ends at its
exit timestamp. It excludes final atomic bookkeeping, the callback wrapper and
part of timestamp-call overhead. The exported software calibration separately
measures whole RAII-loop averages, including bookkeeping and loop cost, on the
current host. Its samples never enter the audio callback's histogram. The clock's
nominal tick and minimum observed positive delta are separate fields; neither
claims timestamp accuracy or device timing qualification.

Counts include observed maximum, saturated elapsed total, unknown nominal
periods and observed-scope deadline misses. The deadline is the current callback's
actual frame count divided by its negotiated device sample rate. This nominal
buffer period is **not** a round-trip latency measurement. A miss means the
observed scope exceeded that period; the excluded bookkeeping means the count
cannot certify that other callbacks met their complete deadlines.

A p99.9 descriptive estimate is still exported below 1000 samples, alongside
`insufficientQualificationSampleCount=true`; reaching 1000 samples does not
establish any device qualification.

Histogram bounds are inclusive upper bounds: [0,250 ns], then successive powers
of two, with the final open-ended bucket above 1.048576 seconds. Exported p50/p95/
p99/p99.9 values are bin-upper estimates, never exact percentiles. An estimate in the
open-ended bucket is null with an explicit flag. Snapshot reads are bounded to
16 attempts; `consistent=false` marks a concurrent, best-effort read. Saturated
aggregates carry an overflow flag. Values beyond signed JSON integer range use
exact decimal strings rather than wrapping negative.

`setCallbackProfiling(bool)` and `resetCallbackProfile()` detach the audio
callback while changing state. Enabling warms the clock on the message thread
before reattaching, keeping any first-use clock initialization outside audio. They stop playback/monitoring, which must be
resumed explicitly. During recording these controls refuse the change rather
than interrupt or silently shorten the take. `callbackProfileSnapshot()` returns
an exportable JUCE JSON value containing bins, estimates, actual nominal-period
range, calibration/context labels and fixed-storage sizes. File saving remains a
message/file-worker operation; no export occurs in the callback.

Verification uses deterministic injected elapsed times for counts, deadline
edges, percentile bounds, unknown periods and aggregate/bucket overflow; it also
checks concurrent snapshots, monotonic counts/clock, reset and disabled behavior,
and zero C++ allocations through record/snapshot and real RAII scopes. The concrete benchmark run, source digests, host/toolchain/date and raw output
are saved in `callback-probe-benchmark.json`. These are host microbenchmark
observations, not portable performance thresholds or device qualification. No
audio device was opened by this standalone benchmark. Real callback deadline,
device lifecycle and round-trip qualification require the hardware runs.