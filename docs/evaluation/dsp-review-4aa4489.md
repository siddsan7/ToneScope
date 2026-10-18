# Independent DSP merge review

Reviewed exact branch `codex/dsp-microscope` head `4aa4489e78947a80baf3062ca1e177d2cdcf7cf8`, including `4a0f930` microscope/oversampling implementation, `37fd24b` validated low-rate preparation and `4aa4489` interval overflow prevention. Source review covered Engine/Dsp/analysis declarations, implementation, native tests and processing documentation. The reviewer owns independent evaluation, not this DSP implementation.

Decision: no remaining source blocker identified for merging this bounded DSP feature after the exact-head CI passes. This does not authorize production release, hardware/human qualification or an AI quality claim.

The initial review identified two concrete defects: valid explicit 8 kHz settings were rejected while preparing rate-incompatible defaults; reversed extreme signed intervals could overflow before rejection. The fixes validate the supplied initial configuration before state changes and reject reversed endpoints before subtraction. Both have native regressions; the independent declared-rate/channel evaluator now passes 8 kHz. Fixed FIR storage, compensated LR4 phase topology, 32-sample pure-delay declaration and real-time topology-change rejection are consistent with the published contracts.

Independent execution used the orchestrator's integrated development CLI with SHA-256 `11ecf968f08c6b78dc06d64f87a94d09c7ecfa97e213df5ac41394ac20f18b10`. That binary includes root CLI/session/streaming work beyond this DSP PR; it is not an attested build of this PR alone. Evaluator source commit was `89c8f7db6cdf58035c388c1d0a793876ba083cf0`; source and runtime remained unchanged during both recorded runs. The orchestrator must rerun against the final clean integrated commit for release-consistent evidence.

| Run | Outcome | Raw local evidence |
|---|---|---|
| `run-49f02fce328f4ab29da56a3fa73ebbcc` | DSP 12/12 pass | `artifacts/dsp-new-core-first/run.json` |
| `run-79cec51071654a07b501ddd50c6a41aa` | Integration 7/7 pass | `artifacts/integration-new-core-first/run.json` |

DSP evidence includes 15 complex EQ points, 15 complex phase-correct crossover points, compressor full-curve and attack/release crossing checks at 44.1/48/96 kHz, channel/clamp boundary rates 8/44.1/48/96/192 kHz, deterministic block/reset checks and identity/gain/static response. Declared delays 0/1/32 samples null after compensation; incorrect compensation produces a nonzero residual.

All nine predeclared periodic alias stress fixtures passed the unchanged 10 dB 4x-versus-1x improvement gate. Observed improvement was 18.55–26.32 dB. Independent high-rate reference convergence was 0.0000333–0.0000669 RMS against the 0.0001 gate. Full per-mode errors, intended harmonics, gain/phase calibration, convergence and exceptions (none in this bounded sweep) remain in the raw metrics. This establishes the bounded steady-state fixtures described in `numerical-oracles.md`, not universal alias reduction, transient quality or listening preference.

Remaining qualification: final clean integrated CI/evaluator evidence, licensed musical corpus, sequestered holdout, physical callback budget/soak/round trip, human listening/accessibility and release dossier. Agent review cannot substitute for them.
