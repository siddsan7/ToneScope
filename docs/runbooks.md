# Local recovery and support

Core audio is local. Stop monitoring before changing devices or investigating a
fault. Save a new session name before experimenting. Never overwrite the dry
source or an interrupted capture while investigating it.

| Symptom | Inspect | Safe recovery | Useful escalation evidence |
|---|---|---|---|
| Device unavailable / no input | Audio devices, selected channel mapping, native status | Stop monitoring; select the intended available device and channels; resume explicitly | Redacted device type, negotiated rate/buffer, OS and build identity |
| No replay audio | Current render status, selection, transport mode, output device | Pause; choose Processed and a nonempty region; start at low monitor level | Software steps and status; do not include source audio without consent |
| Crackles / high CPU | Stream preparation/starvation status; opt-in callback observations | Stop, increase buffer, reduce oversampling while stopped; reset observations before a controlled rerun | Exported histogram, actual rate/buffer and settings; scope misses are not complete deadline proof |
| Stale analysis | Render revision, busy indicator, source/selection changes | Wait for current render; select a bounded inspection region; reopen the unchanged source if necessary | Build identity, sanitized steps and revision/status values |
| Wrong rate / pitch | Source metadata versus negotiated device rate | Stop, verify source metadata and device settings; reopen through the WAV importer | Rates/channels/frames, not waveform or path |
| Decode failure | Explicit format/bounds error | Keep original; use supported PCM16/24/32 or float32 mono/stereo WAV within 2 GiB/two hours | Decoder reason and independently verified format metadata |
| Missing or changed source | Session digest/relocation prompt | Locate the exact original bytes; import changed audio as a new source | Digest agreement/result, session schema version; redact paths |
| Corrupt session | Schema validation or recovery status | Preserve failed file; recover the previous complete snapshot; do not strip validation fields | Schema version and validation reason; share session contents only after review |
| Disk full / interrupted recording | Capture finalizing, overflow/incomplete status and available disk | Stop capture; free space on the intended volume; recover a copy marked incomplete; retain original partial take | Overflow/duration/fault status and frame counts; incomplete is never a complete take |
| Assistant unavailable / busy | Broker status and optional Node24 availability | Keep using core audio; cancel, wait for prior work, then retry a bounded level request | Redacted reason, request ID and build/version; never bearer tokens or environment |
| Proposal rejected / stale | Current revision, source/graph hashes and native rejection | Dismiss; request again against the current source/selection; inspect preview before explicit Apply | Failure category, identities and sanitized steps; never weaken acceptance checks |
| Upgrade / rollback problem | Package hash verification, active version and manifest-owned files | Stop app; verify package; activate an intact previous version; preserve modified/unknown files | Redacted integrity report, package digest/version; no recursive manual deletion |

Create a redacted package support report using `scripts/diagnostics-dev.ps1`.
Export callback observations explicitly from the app when relevant; these include
device identity/settings, so review them before sharing. Reports are saved locally
and never uploaded automatically. No default cloud telemetry, waveform capture,
credential logging or automatic update service is enabled.

For a reproducible defect retain the failing build identity, a minimal licensed or
synthetic fixture, expected versus actual result and the failing regression output.
The physical device, listening and human accessibility protocols in
`../qualification/` remain required; software support reports cannot complete them.
