# Reviewed remote integration

User authorization: commit the integrated followups, open a draft PR, run remote
CI, and merge after independent review. Paid AI execution stays disabled. This
does not authorize a public executable release or deployment.

Acceptance: commit only the reviewed source/tests/docs; retain all numerical
gates and frozen corpora; pass both configured Windows and Linux sanitizer jobs
on the exact PR head; obtain independent review of that head and resolve all
blocking findings before merge. Any code fix requires a new reviewed head and
passing checks. Do not bypass branch protection or impersonate human approval.

The integration includes persistent Faust state, the presentation baseline,
isolated desktop probes, frozen offline level/compression experiments, conservative
rules, and the accessible selection-summary prototype. Local precommit evidence
is in `delivery/integration-closeout.md` and ignored
`artifacts/integration-closeout/verification.json`. That private package remains
an explicitly dirty-working-tree snapshot, not clean-commit CI evidence.

CI keeps standard and streamed embedded reports in separate directories. Frozen
model arms remain blocked; the original replay gate must report passing offline
protocol checks and blocked live qualification. Public CI uploads still exclude
unsigned executable/ZIP/broker staging payloads. Hardware, human listening,
Narrator/actual speech, licensing/signing and clean-machine qualification remain
external to these development checks.

The PR head, independent review comments and GitHub Actions run identities are
authoritative for remote status. Current local orchestration records belong in
ignored `artifacts/remote-integration/`; do not replace earlier package identities
or infer live-model qualification from offline results.
