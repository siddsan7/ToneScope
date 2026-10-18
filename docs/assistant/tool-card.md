# Tool card

The five Eve files under `services/audio-assistant/agent/tools/` compile typed strict Zod schemas and call the same bounded request implementation as the broker. A trusted provider binds an already authorized request to an Eve runtime session through `bindEveSession`; unbound sessions fail closed. Direct Eve HTTP ingress always denies authentication. Eve defaults, connections, skills, delegation, shell, file tools, web tools, sandbox compute, and outbound network tools are absent or disabled. The custom sandbox provider prepares an inert artifact and throws from start/resume. There is no apply, runtime compilation, arbitrary path, or arbitrary command tool.

| Tool | Inputs | Capability |
| --- | --- | --- |
| get_session_snapshot | empty closed object | Current authorized opaque handles, source/graph hashes, selection, revision and continuous parameter registry |
| get_measurements | empty closed object | At most 32 finite native baseline measurements |
| render_candidate | closed parameter_patch array | At most 3 bounded native render candidates from authorized parameters |
| compare_candidate | opaque preview_id | Native measured comparison of a candidate created by this request |
| propose_change | exact B.3 proposal | Validate evidence/parameter/revision/hash/selection bindings and an actually evaluated preview; return a proposed transaction |

Unknown fields, duplicate parameter patches, topology changes, nonfinite values, invalid units/ranges, unrecognized preview IDs and fabricated evidence fail closed. `requires_user_acceptance` must be literal true. Evidence is the exact measurement ID/value/unit returned by the adapter. Numerical facts belong in structured evidence: decimal digits in free-form hypotheses/tradeoffs/limitations are forbidden. This intentionally conservative language rule is deterministic, not a comprehensive semantic entailment proof.

Request limits are 8 KiB JSON, 32 baseline measurements, 8 tools, 3 candidates, 30 seconds cumulative actual processed frames at the session sample rate, 60 seconds wall time, 12,000 input tokens and 4,000 output tokens. A cropped selection reserves processing from zero through selection end plus the native baseline's alignment samples; long prehistory can exhaust the cap even for a short selection. Manifest processed_frames must match the reservation. Cancellation aborts child processes, and post-call checks reject late results. A final native snapshot and preview digest check precede ready status.

NativeCliAdapter receives host-selected absolute paths and a fixed executable. It writes a private UUID session config and invokes `execFile` with an argument array, `shell:false`, hidden windows, a 55-second child timeout and 64 KiB output cap. No model text becomes an argument or filename. The adapter verifies source, baseline graph/source/artifact hashes, native render metadata and the final preview hash. Explicit native acceptance must independently revalidate current revision, graph, source, selection and artifact immediately before its one undo transaction.

The native client validates the complete ready envelope again, derives the candidate graph from the closed parameter patch, reads the native sidecar, hashes the actual WAV, and independently measures its RMS/peak before exposing audition or acceptance. Baseline evidence is independently measured from the exact native audio cache or bound to exact full-band native selected aggregates. Measurement-only comparison omits residual. Host-only `baseline_metrics` never grants model file access.
