# Private demo refresh after PR #8

Goal: check post-merge CI, rebuild and smoke-test the private demo with the merged offline startup fixes. Preserve all existing checks and keep paid AI disabled. Acceptance: clean merged source identity, passing CI, verified installed package, actual installed startup/assistant/summary/streamed workflows, refreshed listening evidence, and successful normal launcher startup.

PR #8 merged as `1c32a38875ebf08d81b8e0f2bc5f95233b06cc0d`. [Post-merge CI run 39350998442](https://github.com/siddsan7/ToneScope/actions/runs/39350998442) completed successfully: Windows/native and portable sanitizers passed. The nightly-only public musical corpus step was skipped by its existing condition. No check or numerical limit changed.

The fresh private version is `0.1.0-demo-pr8-1c32a38`, compiled from that clean commit. Its actual compiled identity, ZIP/executable hashes and retained logs are under ignored `artifacts/demo-pr8-1c32a38/verification.json`. Documentation edits in this refresh postdate the binary. No product source, corpus, workflow, or launcher code changed.

Local checks passed:

- Native 9/9, UI state/discovery 7/7, offline startup SDK-denial regression 1/1, package/install/privacy regressions 33/33, UI smoke guards 6/6.
- Extracted and installed package verification; all 25 manifest files verified again after the installed UI probes.
- Installed desktop startup/singleton screenshot; actual embedded assistant preview, explicit apply, undo, baseline/candidate comparison and frozen RMS match.
- Selection-summary unavailable states, keyboard and speech routing; the speech test uses a double and does not qualify audible speech or Narrator.
- The existing embedded assertions also passed on a streamed 121-second source with metrics-only passage evidence.
- Four attributed musical examples, eight audition clips and three measured plots regenerated with the merged CLI. Independent curve/timing/alias checks passed. All 199 listening evidence hashes match; the cue source hashes match the previously measured originals.
- Stable launcher verification and normal launch from another working directory. After the user's explicit approval, the older demo window closed gracefully and the refreshed normal app opened. The previous installed version is retained for rollback.

Full service/frontend/Python suites, mutation campaigns, frozen experiments, pinned Faust regeneration and Linux sanitizers were not rerun locally for this refresh. Their exact merged-head remote CI results are separate evidence; the local checks above do not substitute for them.

The historical intermittent assistant timeout remains unconfirmed and unlocalized. Passing this smoke test does not prove it eliminated. Hardware, human listening, audible speech/Narrator, clean-machine installation, signing and live model qualification remain outstanding. No paid provider calls, public binary upload, new commit, merge or deployment occurred.

Open the app with root `Open ToneScope.cmd`. Use the refreshed [runbook](../docs/showcase/demo-runbook.md) and existing [90-second scripts](../docs/showcase/walkthrough.md). The fresh listening page is `artifacts/demo-pr8-1c32a38/listening/index.html`.
