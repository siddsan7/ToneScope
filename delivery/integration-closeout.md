# Combined followup integration

Scope: review and integrate the presentation, persistent Faust compressor,
desktop startup, offline evaluation, level/compression rules and selection-summary
followups. Build a fresh private unsigned package. Paid execution stays disabled;
merging and public distribution remain for user review.

Acceptance: preserve every existing numerical gate and frozen corpus; run the
Windows native/frontend/service/Python suites, generated Faust verification,
contracts/DSP/integration evaluations, original blocked-live replay gate, all
three product mutation campaigns, portable ASan/UBSan tests, embedded offline
assistant and summary workflows, and package/installation regressions. Verify
the extracted package and smoke-test its actual executable and bundled broker.
Retain binary, source and package identities with the evidence. No hardware,
human accessibility/listening, model or production qualification follows.

Independent read-only reviews covered assistant contracts/acceptance/evaluation
and desktop startup/summary/speech/DSP/packaging. Three findings were corrected:

- Renderer and evaluator source identities now include nonignored new files,
  with NUL-delimited Unicode paths and tracked deletion markers. A disposable
  repository regression proves new-file edits change both identities, ignored
  evidence does not, and no staging is needed.
- Metrics-only desktop requests omit unavailable manual passage evidence in both
  snapshot creation and freshness checks. Level requests remain available;
  compression still requires actual passage evidence. The native adapter's
  rejection of fabricated metrics-only passage evidence remains unchanged.
- Level rules require a complete supported clause. Noise removal, reference
  comparisons and additional unknown objectives abstain without rendering.
  Existing explicit acceptance and supported level requests remain intact.

The original embedded assertions also run with a streamed 121-second source and
a marked 12.1-second selection, beyond the 10-second inspection cache but within
the assistant budget. `scripts/test-embedded.ps1 -Assistant -MetricsOnly` selects
this regression. The default four-second fixture and all original assertions
remain. Startup/embedded scripts accept `-Executable` so package checks exercise
the delivered executable in its own directory, including its sibling broker.

Current machine-readable results and raw logs: ignored
`artifacts/integration-closeout/verification.json`. This file, rather than older
PR4 evidence, identifies the current package, exact source composition and tests.
Failed attempts remain separate: restricted loopback/temp/audit access, an early
Linux tool setup race, short/out-of-window streaming fixtures, and stale
renderer identities after review edits. No gate was weakened to hide them.

The package is a dirty-working-tree development snapshot whose source fingerprint
includes pending files. It is not clean-commit CI evidence. No commit, push,
merge, deployment or public binary upload is part of this closeout. Local Linux
sanitizers do not impersonate the configured remote Ubuntu CI run. Exact-head
remote CI remains a pre-merge requirement after the user reviews the changes.
