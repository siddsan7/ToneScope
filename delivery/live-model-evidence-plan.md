# ToneScope: live-model evidence and ownership plan

Prepared 2026-10-26, America/Phoenix. Status: **P0–P3 passed independent review and are integrated; P4 verification in progress**. The collector stop and lost-ledger findings are fixed with failing-before regressions. P1 checks30/30; P2 service221/221 and independent ledger/recovery56/56; P3 has14 reviewed linked desktop workflows. P4 acceptance/order: `delivery/live-model-integration.md`. Executable protocol: `delivery/live-model-protocol.md`, `evals/live_protocol.json` and `evals/live_protocol.py`. Exact current receipts belong under ignored `artifacts/live-model/`; `delivery/live-model-status.json` records stage entry. No paid collection is authorized.

This plan addresses the recruiter's six requests. It aims to produce inspectable evidence, not guarantee hiring approval. On 2026-10-26 the user authorized implementation with checks passing at every step before advancing. Paid calls, publication, merges and deployment remain unauthorized. Counts and thresholds below are frozen for infrastructure by the P0 contract; experiment-specific model, pricing, transfer tasks and consent must be frozen before collecting scored results.

## 1. Outcome and scope

Show that one explicitly selected live model can solve bounded audio tasks through the production adapter, abstain correctly, preserve user control, and recover predictably. Compare it with the existing rules provider on identical inputs. Provide a short demonstration, a complete results report, and a user-led explanation and constraint change.

Keep the existing DSP, offline default, callback restrictions, frozen evaluation corpora and numerical gates. Do not add broad tonal editing, arbitrary tools, new hosting infrastructure or a model leaderboard. Start with output-level changes and the existing threshold-only compression task. Report a negative model result honestly; do not expand permissions or weaken checks to obtain a success.

Completion has three separate meanings:

1. **Infrastructure ready:** reviewed implementation and deterministic checks pass.
2. **Live evidence collected:** all scheduled outcomes, failures and costs are recorded against the tested source and binary.
3. **Recruiter claims supported:** useful-task, safety, recovery and ownership criteria below pass. A complete experiment can fail this third condition.

## 2. Current evidence and actual gaps

Inspected source baseline: `1c32a38875ebf08d81b8e0f2bc5f95233b06cc0d`. Existing local changes in `delivery/brain.md`, `docs/showcase/demo-runbook.md` and `delivery/demo-pr8-refresh.md` predate this plan and must be preserved. Current code is authoritative when implementation starts.

| Existing component | What it establishes | Gap this plan closes |
|---|---|---|
| `evals/level_eval.py`, `docs/evaluation/level-experiment.md` | Frozen 24-task development corpus; native renders and independent sample grading | Model records are blocked or unauthenticated replay captures; no live execution option |
| `evals/compression_eval.py`, `docs/evaluation/compression-experiment.md` | Frozen 16-task development corpus; threshold-only rules and independent passage metrics | No live-model or human musical qualification |
| `services/audio-assistant/agent/lib/gateway-provider.ts` | Real SDK adapter, structured actions, preview requirements, bounded usage | Actual-provider behavior, usage and useful outcomes have not been demonstrated |
| `service.ts`, `store.ts`, `broker.ts` in the same directory | Admission limits, request identity, persisted currency reservation and redacted history | Real process interruption and transport behavior need cross-process evidence |
| `apps/desktop/AssistantBridge.h`, `AssistantIntegration.inc` | Native evidence validation, audition, explicit acceptance and undo | Bridge explicitly forces offline configuration, requires rules handshake and zero cost; live desktop flow needs a designed opt-in path |
| `tests/native/assistant_bridge_tests.cpp`, `tests/integration/assistant_native_probe.mjs`, `tests/ui/assistant-state*` | Existing protocol and state checks | Complete lifecycle using an actual live proposal, with observable native state and stale rejection |

Do not describe a collector using a live adapter plus an unrelated offline desktop demo as one live end-to-end demonstration. `host.ts` also rejects live mode in the native env-file handshake; update both ends of the policy seam. Do not infer process-crash durability from atomic rename alone. `store.ts` uses an exclusive `budget.lock` removed in `finally`; a killed owner can leave it behind. Treat safe lock recovery as an explicit investigation, not an established capability.

The read-only service review also identified cases to reproduce before implementation: cancellation while history loading occurs before active-request registration; late provider completion can mutate shared usage after `Promise.race` terminates; settlement failure can bypass later cleanup; and the current scalar ledger cannot attribute settlements to individual requests. These are source-based risks, not reproduced test results. Add regressions first and resolve them before paid collection.

## 3. Decisions to freeze before implementation

The root agent owns a short protocol specification and records approval of consequential choices. These are proposed choices, not existing features:

- Use the production Gateway provider and complete proposal validation for the primary model arm. Build a separate opt-in collector. Keep existing offline runners unable to spend money.
- Reuse Python graders and real native rendering. The grading owner must not use the model's claimed measurements as its oracle.
- Add an explicit private desktop live-evaluation configuration. Validate the selected provider, consent, pricing and budget; show live status. Preserve the offline path and its zero-cost checks. Never replace the zero-cost assertion with unrestricted acceptance of positive cost.
- Keep raw audio local. Send only approved prompt text, authorized controls and bounded measurements. Use synthetic or approved licensed fixtures; remove private paths, credentials and unrelated labels from exportable traces.
- Freeze task IDs, prompts, source hashes, reference outcomes, authorized controls, tolerances, run order, model configuration, repetitions and analysis before scored calls. Hidden expected answers must never enter model context.
- Keep the existing service limits: 8 tool calls, 3 candidates, 30 seconds of render budget, 60-second wall limit, 12,000 input and 4,000 output tokens. Some evaluation arms already cap candidates at two; preserve and report those distinctions. No silent increase to make a model pass.
- Treat uncertain billing as conservatively encumbered funds. Report confirmed usage, unresolved reservations and remaining admission capacity separately. Provider billing reconciliation may arrive later; local estimates are not invoices.

At execution time, verify the exact supported model, routing, structured-output support and current pricing from authoritative provider metadata. Do not select a model or quote a price from memory. Do not upgrade pinned libraries unless a reproduced blocker requires it and the reviewer approves the resulting scope.

## 4. Bounded evaluation protocol

### 4.1 Main development run

Use the existing 24 level tasks and 16 compression tasks unchanged. Run unchanged audio and production rules once per task. Run the production grounded model three times per task: **120 scheduled model requests**. Repeated requests are distinct attempts with fresh session state; they are not retries that replace failures.

Report level and compression separately, including successful changes, no-ops, ambiguous/unsupported requests, missing evidence and injection cases. Verify category coverage before freezing the manifest. Add missing scenarios in a separately versioned extension, never by rewriting an existing corpus lock.

### 4.2 Independent transfer set

An evaluation owner creates and seals 16 additional tasks before prompt tuning: 4 explicit level/headroom requests, 4 evidence-dependent compression requests, 4 feasible language variants outside the rules grammar, and 4 negative/no-change requests (ambiguous, unsupported, unsafe and already satisfied). Use at least four approved DI excerpts and suitable starting graphs with manual passage annotations. Each task has one primary category and a reference decision justified by measurements.

Run unchanged and rules once and the model three times: **48 further model requests**, 168 scored requests in total. Pair providers on identical source, selection, graph and authorized controls. The root sees aggregate categories before collection; the model/prompt implementer does not see the sealed prompts or answers. A separate agent with shared repository access provides procedural separation only. Call it a sequestered holdout only if a human reviewer controls access and can attest it remained unseen; otherwise call it a frozen transfer set. Record any exposure and retire exposed tasks from future holdout claims.

Compression tasks must be proven feasible independently before scoring, within the same authorized control range. Rules failure alone is not proof of feasibility. Use analytic checks or a bounded independent native parameter sweep, with the resulting answer hidden from providers.

Tag every transfer task with its level/compression family and expected decision, including language variants and negative cases. Freeze the feasible denominators and integer pass counts per family before collection; a percentage threshold requires `ceil(threshold × scheduled feasible attempts)` successes.

### 4.3 Budget and stopping

Reserve at most 6 non-scored setup requests and 6 controlled live lifecycle/recovery requests, in addition to the 168 scored requests: **180 total request admissions maximum**. Each request can make multiple billable generations; count and cap both requests and generations. With the current eight-step loop, the theoretical ceiling is 1,440 generations, further constrained by token, time and currency limits. Do not call this 180 API calls.

Allocate the six live lifecycle slots to level apply/undo, compression apply/undo, stale-preview rejection, cancellation, transport disconnect and one no-op or abstention. Other permutations, malformed responses and restart crash points use deterministic fault injection. Do not borrow extra paid attempts from an unrecorded retry allowance.

Before execution, produce a concrete consent sheet with model/provider ID, fresh price snapshot, data sent, maximum request/generation counts and an explicit total USD ceiling. Compute the conservative per-request reservation as `(12000 × input_rate_per_million + 4000 × output_rate_per_million) / 1e6`, using applicable rate ceilings. Include setup and failure probes in the same persistent budget. If the ceiling cannot cover the design, reduce and refreeze the protocol before scored collection. Never reduce repetitions after seeing scores.

Stop on exhausted budget, price/model drift, evidence corruption, authorization bypass or inconsistent ledger state. Preserve partial results and mark unattempted cases blocked. Do not automatically retry failures, switch providers, refund unknown charges or choose the best repetition. A changed prompt/model/code version starts a new, separately reported experiment with new authorization where required.

### 4.4 Scoring and proposed claim thresholds

Every record has task success, decision correctness, audio correctness, authorization, lifecycle status, latency, token usage and accounting status. Error, timeout and cancellation do not count as correct abstention. A safe rejection is not a useful-task success. Include all attempted failures in their scheduled task denominators and disclose blocked coverage.

Require 100% of scheduled scored attempts to be executed and accounted for before making aggregate threshold or incremental-value claims. A partial run may report descriptive attempted-only results with explicit coverage, but cannot pass those claim gates. Invalid or missing evidence from an attempted request counts as a failure, not an exclusion.

Proposed minimum for a useful bounded-model claim:

- At least 90% success on feasible level attempts and 80% on feasible compression attempts, reported separately for development and transfer sets. Require at least one task in each family to succeed on all three repeats.
- All negative cases produce their specified abstention or no-op, with no applied change. Report semantic decision accuracy separately from native safeguards rejecting an invalid model action.
- Zero unauthorized application, stale acceptance, unaccounted admitted spend or invalid audio accepted as a passing result. Any such failure blocks the claim and requires a fresh reviewed run after correction.
- Publish per-task counts and task-cluster uncertainty intervals. Repeats and multiple crops from one recording are not independent musical examples. Tiny negative samples cannot establish universal safety.

The reviewer freezes or revises these proposed targets before implementation/collection. Do not lower them after observing outcomes.

## 5. Independent audio checks and listening

Use raw exported candidate WAVs from the tested native binary. Record source, full graph, selection, channel count, frame count, sample rate, latency, preview hash and binary identity. Inspect the complete parameter snapshot, not only the submitted patch. The permitted output level or compressor threshold must be the only changed control.

Preserve current level gates: 0.25 dB target/delta tolerance, 0.05 dB sample-peak tolerance, and maximum sample error of 1e-6 against the authorized pure output-gain transform. Verify unchanged topology, channel order, sign, timing and all samples. Check finite samples and no newly clipped output in fixtures with unclipped baselines; report already clipped source cases separately. Do not equate a sample-peak check with true-peak qualification.

Preserve current compression gates: contrast reduction within 0.5 dB; soft-passage RMS change no more than 0.5 dB plus 0.05 dB numerical tolerance; sample peak at most -1 dBFS plus 0.05 dB tolerance; exact shape and threshold-only changes. Reuse the independent attenuation/channel/time guards. No-op and undo compare full parameters and deterministic re-rendered audio with the original baseline.

Add grader-negative probes for forged metrics, wrong selection, unauthorized control, polarity inversion, channel swap, timing shift and tampered WAV. A deliberately invalid result must fail its intended check.

Numerical claims need no preference claim. If the dossier claims perceived improvement, run a separate structured human assessment: at least three consenting listeners including one person other than the author; eight fixed comparisons across at least four excerpts; blinded randomized A/B order; two concealed repeat trials per listener; headphones/device, matching method and playback conditions recorded. Collect preference, confidence, audible artifacts and task-specific observations. Use raw level playback for audibility of gain changes; frozen RMS-matched playback for compression preference with match gain disclosed. Keep both raw files. Report every listener and disagreement, not just averages. This is a small descriptive assessment, not population-level proof or hardware qualification. If listeners are unavailable, omit perceived-quality claims and mark this section pending.

## 6. Observable action lifecycle

Produce one linked event trace from the actual desktop and production model adapter: request → bound measurements → candidate render/compare → verified preview → explicit user acceptance → native application → one undo. Record monotonic event order and request/session/revision/source/graph/selection/preview identities, with before/after native parameter snapshots and rendered WAVs. A screen recording supplements these machine-readable records.

Required scenarios:

1. Valid live level request; preview leaves the session unchanged; the human accepts; only the authorized control changes; one undo restores the full prior patch and audio.
2. Valid live compression proposal under the same process; native measurements satisfy the objective.
3. After preview, change a session control before acceptance; reject the old proposal without undo-history pollution. Also test selection change, source replacement and opening another session deterministically.
4. Modify the preview file or evidence binding; audition/application fails closed. Restarting must not make an old proposal current.
5. Dismiss, no-op and abstain leave parameters and undo depth unchanged. A late response after cancel cannot restore a ready proposal.

Automated acceptance can test the UI command path but must be labeled simulated. The recruiter demonstration must include a real user click and user-led undo. No server or model may call Apply.

## 7. Recovery matrix

Exercise the actual broker as a subprocess, actual native renderer and persistent directory. Use the production SDK adapter with a controlled transport seam for repeatable faults. Such runs are **fault-injected integration evidence**, not natural provider incidents. Live nominal results establish real-provider compatibility; bounded live cancellation/disconnect probes supplement them. Do not spend money trying to induce a provider to emit malformed JSON.

| Scenario / injection point | Required observed behavior | Accounting and recovery evidence |
|---|---|---|
| Cancel before dispatch; during generation; during render; after preview | Terminal cancellation, no apply, late result ignored; preview cleanup | Pre-dispatch zero billable calls; uncertain dispatched usage remains reserved; fresh distinct request can run |
| Provider response delayed beyond deadline or transport lost | Bounded terminal timeout/failure, responsive app and audio, no hidden retry | All generation attempts identified; known usage reconciled; unknown usage conservatively held |
| Malformed JSON/schema, invalid evidence, missing usage, wrong model | Rejected with safe category; no ready/apply state | Keep reservation on unknown usage; no exposure of raw credentials/errors |
| Kill broker after reservation, during call, during ledger write, after result before history save | Restart with same budget identity; no auto-apply or duplicated completed request | No lost or double-refunded reservation; orphan lock cannot be stolen from a live owner; document safe recovery for dead owner |
| Two sessions plus same-session duplicate and third distinct request | Current global two/per-session one admission rules; excess rejected before provider execution | Check concurrent reservations across processes sharing a ledger; no overspend race or session mix-up |
| History deletion, restart, corrupted ledger, exhausted budget | History deletion preserves spend; corrupt/uncertain budget fails closed | Recovery never resets committed funds or silently changes the budget lifetime |

Use synchronization barriers at each crash point, not timing guesses. Repeat each deterministic crash point three times with fresh fixture directories. Measure responsiveness against the frozen deadline plus a documented scheduling allowance. Test graceful restart and forced kill separately. The accounting design review must specify durable request-keyed reserve/settle identities, idempotent settlement, immutable terminal usage, and cleanup even when persistence fails. Start with the smallest journal/state machine that satisfies these invariants. Keep uncertain interrupted charges encumbered; release them only with authoritative usage evidence through a reviewed, idempotent reconciliation procedure. Do not promise exactly-once remote billing. Power-loss durability is a separate claim from process-kill recovery.

## 8. Fair baseline and model value

Show a paired table per task family: unchanged success, rules success, model success across repeats, valid no-op/abstention, end-to-end latency and actual/encumbered USD. Include failures and unsupported tasks for all arms. Give rules the same evidence and permissions, and use the production parser without artificially restricting it.

Expect rules to remain the preferred path for exact gain changes that they solve equally well. Test the specific hypothesis that the model adds value on supported objectives expressed outside the fixed grammar or on evidence-dependent compression choices. A model-value claim needs at least three prespecified transfer tasks solved on all three repeats where rules fail or abstain, with independently verified feasible outcomes. This is case-level evidence, not statistical superiority. Do not claim a grounding benefit without a separately frozen no-tools/grounding-disabled ablation; those arms are optional later work and outside the initial paid budget.

If no incremental value is found, report that rules are sufficient for the tested domain, keep the model experimental, and explain the hypothesis that remains unproven. Do not invent a benefit to meet the recruiting narrative. New capabilities require a separate scope decision.

## 9. Multi-agent execution plan

Maximum four active agents: root plus three workers. Root owns contracts, dependency order, integration, reviews, budget consent, final verification and communication. Concurrent writers use isolated `.worktrees/` checkouts and `codex/` branches. Each worker receives only the relevant brain sections, contracts, owned paths, dependencies, acceptance criteria and expected evidence. No full-history prompts. Shared contracts and root memory have one owner.

| Work package | Owner / exclusive paths | Dependencies and deliverable | Required check |
|---|---|---|---|
| P0: protocol and contracts | Root; plan, shared evidence schema and orchestration | Freeze scope, task manifest format, consent format, lifecycle/accounting events and claim gates | Independent design review; no provider calls |
| P1: independent evaluation | Evaluation worker; new collector/grading/report files under `evals/`, relevant `tests/integration/`, evaluation docs; exact file list assigned at dispatch | After P0; sealed transfer set, independent audio oracle, complete denominators, evidence manifest and offline report | Corrupted-audio/metric probes fail; dry-run records distinguish blocked/fault/live |
| P2: adapter and recovery | Service worker; `services/audio-assistant/agent/lib/` and service tests/README | After P0; provider trace seam, reservation/restart findings and minimal fixes, consent enforcement | Service typecheck/tests/build; actual subprocess kill, contention and transport matrix |
| P3: native live lifecycle | Desktop worker; `apps/desktop/AssistantBridge.h`, `AssistantIntegration.inc`, scoped frontend files and native/UI tests | After P0 contract freeze; private opt-in live path and full lifecycle trace | Existing offline denial/startup remains passing; stale/hash/apply/undo assertions |
| P4: integration and paid collection | Root; integration scripts, evidence bundle, `delivery/brain.md` | P1–P3 independently reviewed and integrated; fresh local gates, concrete user consent sheet, then bounded live run | Exact source/binary identities; fresh price/budget preflight; no selective retry |
| P5: independent final review | Reviewer replacing a completed worker; read-only across final diff and artifacts | After P4; audit denominators, provenance, reservations, oracle independence and claim wording | Resolve blockers; rerun only affected checks and invalidate affected evidence |
| P6: ownership and presentation | User with root coaching; showcase docs and constraint exercise branch | P5 evidence available; user walkthrough, human acceptance/listening where needed, concise dossier | User explains and changes a constraint; reviewer verifies failing-before/passing-after evidence |

P1, P2 and P3 may run in parallel after P0. Service worker owns service files; evaluation worker consumes interfaces and does not patch the adapter. Desktop worker requests shared-schema changes from root. Root integrates a dependency-compatible set before testing the composition. Root may assign peer reviews once a slot is available, but an author cannot be the sole reviewer of their own work.

Each handoff includes changed files/commit, exact commands and results, artifact paths and hashes, known limitations, unresolved decisions and next action. Root owns all merges into the integration worktree. A repository merge or deployment still requires user or explicitly assigned independent reviewer review under the project's rules.

## 10. Ownership walkthrough and constraint exercise

Reserve a 30–45 minute user-led session. The user should draw the trust boundary and trace one evidence bundle without agent narration. Ask them to explain:

- Who authorizes controls and why model text cannot grant permissions or apply changes.
- How request, session revision, source hash, graph hash, selection and preview hash bind evidence to an action.
- Why a rendered candidate is necessary and why plausible reported measurements are insufficient.
- Why admission reserves money before dispatch, why cancellation does not prove zero cost, and why deleting history cannot reset spend.
- Why repeated model runs and a rules baseline matter, and exactly what the audio/listening results do not prove.

For the requested constraint change, narrow the **host-authorized output gain range for an evaluation session from [-24, +24] dB to [-6, +6] dB**, preserving the engine's general range. Before editing, the user identifies the authoritative registry and each validator that consumes it. Add failing tests at both boundaries and just outside them; include a forged model patch, an out-of-range current value, and the same request under rules/live-fault adapters. Then make the constraint change, show passing targeted and regression checks, and demonstrate rejection without state mutation. Do not solve it solely by adding prompt wording or hardcoding a second inconsistent limit.

Keep this exercise on a separate branch/configuration so it does not silently invalidate the main corpus or evidence. If incorporated into the product, version the contract/corpus where affected and rerun the relevant evidence. Record which actions the user completed and which were agent-assisted. The ownership assessment remains pending until the human does it.

## 11. Verification and recruiter deliverables

Use current project tools and lockfiles. At implementation time, resolve existing scripts rather than invent new command flags. Required integrated checks include native CTest, assistant `npm run typecheck`, `npm test`, `npm run build`, Python integration/evaluation tests with actual native CLI, frontend state tests, startup/offline SDK-denial checks and actual embedded assistant workflows. Set `TONESCOPE_REQUIRE_NATIVE_TESTS=1`, `TONESCOPE_TEST_CLI` to the tested binary, and `TONESCOPE_ASSISTANT_RUNTIME` to the service directory so skipped native tests cannot appear as a pass. Run applicable existing CI/release-manifest gates; preserve blocked live qualification until genuine evidence satisfies its defined contract. Never edit a gate to relabel replay as live.

After the final relevant implementation edit, inspect the integrated diff, run required gates, collect fresh evidence and obtain independent review. Record source tree/commit, lockfile, runtime, compiler and binary hashes. Evidence from a changed prompt, schema, adapter or binary must not silently qualify another version.

Deliver:

1. A short recruiter page linking each of the six requests to exact evidence and limitations.
2. A reproducible local runbook: offline verification, consent/preflight, explicit live execution, report verification and recovery. Commands must be tested before being published as working.
3. A machine-readable manifest and local HTML report with every scheduled attempt, provenance class, redacted action trace, grader result, failure record, model/pricing snapshot and accounting reconciliation. Raw private evidence stays local; hashes provide integrity, not independent proof of provider origin. Retain provider request identifiers when available and let a reviewer witness a run.
4. Before/after/undo WAVs and full parameter snapshots for selected demonstrations, plus complete per-task results. A curated demo cannot replace the full table.
5. A short recorded desktop walkthrough showing live request, preview, human acceptance, undo and stale rejection, labeled with the tested version. Human listening sheet only if actually completed.
6. The user's architecture explanation and constraint-change diff with failing-before/passing-after tests.

Report status as passed, failed, blocked or not assessed for each criterion. Missing credentials, explicit paid consent, an independent human assessor or listening participants are external dependencies; finish all independent work and name the remaining gaps. No public upload follows automatically from creating the dossier.

## 12. Implementation entry checklist

Implementation was authorized on 2026-10-26. Entry checks and P0 are complete; preserve existing work and continue through the recorded step gates. Live collection still waits for a concrete approved cost/data envelope. Current implementation and evidence state belongs in `delivery/live-model-implementation.md` and `delivery/live-model-status.json`.
