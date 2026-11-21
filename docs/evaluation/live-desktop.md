# Private desktop lifecycle evaluation

P3 adds an explicit private evaluation path to the existing assistant. Normal launches remain offline. The model and broker have no Apply tool. Only the desktop acceptance command can commit the verified parameter transaction.

## Goals and boundaries

Acceptance requires the actual Gateway SDK fetch path, broker, native CLI tools, embedded React page and desktop parameter history. It covers level and compression preview, simulated acceptance, apply, one undo, stale controls/selection/source/session, modified preview audio, cancellation during SDK fetch, late responses, dismissal, noop/abstain, and a broker restart with duplicate dispatch denied. These are software checks with deterministic HTTP responses. They do not qualify a provider model, human acceptance/listening, physical audio, accessibility, or a public release.

Only outputDb is writable for level. Compression permits thresholdDb only; the remaining compressor metadata is fixed and read-only. The frozen development request prompt and request identity must match one of six lifecycle admissions in the complete 180-entry admission manifest. A launch selects exactly one request identity. There is no automatic retry or next-request selection.

## Private configuration

Pass an absolute path using `--private-evaluation-config` to the desktop. The broker accepts the corresponding `--native-evaluation-config` only with its private native environment file. Inherited live environment variables do not enable this path. Production mode cannot load a test fetch module. Fault injection also requires the desktop's explicit hardware-free UI test mode.

The version-one JSON contains `schema_version`, `mode`, `policy`, `canonical_policy_json`, `consent_sha256`, `admissions`, `state_directory`, and `lifecycle_request_id`. Fault injection also includes `test_fetch_module`. Generate `canonical_policy_json` with Node `canonicalJson(livePolicySchema.parse(policy))`; compute `consent_sha256` over those exact canonical bytes. Do not regenerate canonical policy text with JUCE or another number formatter. Native checks the exact text digest and recursively checks its typed JSON value against policy. The host independently requires exact Node canonical text equality and consent digest before importing the SDK or test module. Graph hashes remain native opaque identities.

State storage is absolute and private. One StateStore instance supplies service history, broker GET, prune, deletion and durable budget operations. History deletion retains the budget ledger and request tombstones. Restart does not grant another dispatch for an admitted request. Tests confirm that history deletion and duplicate replay leave ledger bytes unchanged.

## Evidence

Evaluation writes private `desktop-traces` under the configured state directory. Each request has an immutable identity prefix containing the session and request IDs. The JSON binds experiment, budget, consent, attempt/request/session, source, graph, revision, selection and preview. It retains full native `parametersToVar` before the request and at every native lifecycle event, including acceptance, apply and undo. A file already present for the same native attempt is rejected.

The service event segment retains the service sequence, including admission, reservation, generations, measurements, render, compare, verified preview and terminal result. The desktop appends its observed event segment with a continuing export sequence. This is a linked segment order, not a cross-process wall-clock timing measurement. Cancellation can be observed locally before the service terminal segment arrives; its native event is retained along with `late_response_discarded`. Late results cannot restore the proposal or change controls.

Export excludes request text, model prose, source paths, capability tokens and credentials. Service events have an allowlist and their revision/source/graph/selection fields must match the native context. Native verifies snapshots against a typed recursive comparison of the exact outgoing JSON representation; integral JSON numbers and their double representation are equivalent, with no epsilon. Full graph hashes, patch authorization, audio hashes and measurement gates remain unchanged.

Raw selected processed baseline and candidate WAVs are retained privately with hashes and relative filenames. Audition transforms are not written into these files. Acceptance from `--web-ui-test` is explicitly `simulated: true`. Automated acceptance is never evidence of human acceptance. Evidence-write failure before acceptance blocks apply. Audio processing remains independent of optional evaluation storage.

## Checks and artifacts

Run the existing pinned native build and CTest preset. Run service typecheck/tests/build and frontend typecheck/tests/build. The offline SDK-denial and native startup/singleton probes remain required.

`tests/ui/live-desktop-native.mjs` requires explicit `--interface`, `--sources`, `--output`, `--exe`, and `--cli` paths. Its public input is P1's `lifecycle-interface.json`; it does not read transfer answers. `--case` selects `level`, `level-fractional`, `compression`, `compression-wrong`, `dismiss`, `stale-control`, `stale-selection`, `stale-source`, `stale-session`, `tamper`, `cancel`, `noop`, `abstain`, or `restart`. Each run uses a fresh experiment/budget and private directory. The fractional case is an additional development probe with current gain 1.2f, not a frozen scheduled model result. The SDK fixture denies all unrecognized transport URLs and never sends HTTP requests.

The runner drives actual React Ask/Preview/Apply controls through CDP. Before nominal acceptance, `tests/ui/live-desktop-audio.py` independently decodes raw WAVs and enforces the unchanged protocol audio gates. A bounded offline native sweep fixed the compression fixture at threshold -20.5: contrast reduction 2.991685 dB, unchanged soft RMS, and sample peak -12.0412 dBFS. The prior -24 fixture remains `compression-wrong`; the unchanged grader must reject its 5.616685 dB reduction specifically for missing the three-dB objective, and the UI probe dismisses it without acceptance. It compares native controls and trace snapshots, verifies raw WAV hashes, and uses a known prior parameter transaction to prove that previews and rejected/terminal results add zero undo entries and acceptance adds exactly one. Cancellation waits for the actual fetch seam invocation. Restart kills only the owned broker, starts the production host again, then verifies duplicate denial, no new fetch and unchanged ledger. It closes only its own test app and owned broker process.

Current commands, first failures, rerun logs, result JSON, private traces/audio and source/binary hashes are retained under ignored `artifacts/live-model/p3/`. A passing P3 report still needs independent review before integration. P4 must rebuild and rebind the final integrated composition; earlier dirty-worktree binaries cannot serve as final release evidence. No paid execution, merge, deployment or publication is authorized by these checks.
