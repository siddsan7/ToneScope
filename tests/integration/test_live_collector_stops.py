"""Exercise the real collector loop with a controlled subprocess boundary."""
import copy
from contextlib import ExitStack
import json
import re
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals"))
from live_collect import collect, request_digest
from live_evidence import write_json


class CollectorStopTests(unittest.TestCase):
    def exercise(self, status, reason, critical=False, diagnostic=None, accounting_known=None, stall=None):
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as temporary:
            folder = Path(temporary)
            task = {"key": "fixture", "input": {"source": "source.wav", "baseline": "baseline.wav",
                    "parameters": {}, "prompt": "fixed public request"}}
            manifest = {"manifest_sha256": "a" * 64, "tasks": [task], "admissions": []}
            rows = [{"attempt_id": f"attempt_{i}", "task_key": "fixture", "request_id": f"request_{i}",
                     "arm": "model", "attempted": False, "status": "blocked", "provenance": "blocked"}
                    for i in range(2)]
            consent = {key: "b" * 64 for key in ("protocol_sha256", "task_sha256", "schedule_sha256")}
            write_json(folder / "manifest.json", manifest)
            write_json(folder / "records.json", rows)
            write_json(folder / "consent.json", consent)
            args = SimpleNamespace(experiment=folder, cli=Path(sys.executable), runtime=ROOT / "services/audio-assistant",
                                   node="node", offline_baselines=False, run_consented_experiment=True,
                                   consent=folder / "consent.json", preflight=folder / "preflight.json")
            calls = []

            def dispatch(argv, **options):
                request = json.loads(options["input"])["request"]
                calls.append(request["request_id"])
                if stall is not None:
                    return subprocess.CompletedProcess(argv, 3, stall(request), "")
                result = {"status": status, "reason": reason, "request_id": request["request_id"], "trace_id": "trace",
                          "authorization": {} if accounting_known is None else {"accounting_known": accounting_known}, "trace": {}, "snapshots": [], "usage": {}, "evidence_refs": [],
                          "proposal": {} if status == "ready" else None, "preview": {} if status == "ready" else None}
                output = {"request_sha256": request_digest(request), "result": result}
                if diagnostic is not None:
                    output["provider_output_diagnostic"] = {**diagnostic, "request_id": request["request_id"]}
                return subprocess.CompletedProcess(argv, 0, json.dumps(output), "")

            # Other regressions independently cover these evidence boundaries.
            # Here they remain valid so only the real loop's stop rule can halt.
            with ExitStack() as stack:
                replacements = {
                    "verify_manifest": lambda root, value: value,
                    "report": lambda root, value, records: copy.deepcopy(records),
                    "consent_preflight": lambda *unused: (consent, "c" * 64),
                    "snapshot": lambda *unused: {"session_id": "session"},
                    "validate_envelope": lambda *unused: None,
                    "accounting": lambda *unused: {"admitted": True, "status": "encumbered"},
                    "evidence_from_result": lambda *unused: {"status": status},
                    "grade": lambda *unused: {"task_success": False, "critical": critical, "errors": []},
                    "result_binding_errors": lambda *unused: [],
                }
                for name, replacement in replacements.items():
                    stack.enter_context(patch("live_collect." + name, replacement))
                stack.enter_context(patch("live_collect.subprocess.run", dispatch))
                records = collect(args)
            return calls, records

    def test_policy_failures_stop_before_next_admission(self):
        for reason in ("provider_model_mismatch", "provider_snapshot_or_pricing_changed", "budget_ledger_invalid",
                       "generation_budget_exhausted", "provider_usage_exceeded_reservation", "request_failed", "response_bytes_limit", None, ""):
            with self.subTest(reason=reason):
                calls, records = self.exercise("failed", reason)
                self.assertEqual(calls, ["request_0"])
                self.assertTrue(records[0]["attempted"])
                self.assertEqual(records[0]["status"], "failed")
                self.assertTrue(records[0]["protocol_halt_reason"])
                self.assertFalse(records[1]["attempted"])

    def test_native_integrity_and_future_failure_categories_stop_before_next_admission(self):
        source=(ROOT/'services/audio-assistant/agent/lib/native-cli.ts').read_text()
        reasons=set(re.findall(r"throw (?:new )?Error\(['\"]([a-z_]+)['\"]\)",source))
        self.assertTrue({'source_digest_mismatch','baseline_digest_mismatch','preview_manifest_mismatch'}<=reasons)
        for reason in sorted(reasons|{'future_integrity_category'}):
            with self.subTest(reason=reason):
                calls,records=self.exercise('failed',reason)
                self.assertEqual(calls,['request_0'])
                self.assertEqual(records[0]['protocol_halt_reason'],reason)
                self.assertFalse(records[1]['attempted'])

    def test_critical_audio_failure_stops_before_next_admission(self):
        calls, records = self.exercise("ready", None, critical=True)
        self.assertEqual(calls, ["request_0"])
        self.assertTrue(records[0]["grade"]["critical"])
        self.assertFalse(records[1]["attempted"])

    def test_noncritical_provider_failure_is_recorded_without_retry(self):
        for reason in ('provider_call_failed_accounting_reserved', 'provider_usage_missing_accounting_reserved',
                       'provider_output_empty_accounting_reserved', 'provider_output_truncated_accounting_reserved',
                       'provider_output_json_invalid_accounting_reserved', 'provider_output_schema_invalid_accounting_reserved',
                       'provider_step_limit'):
            with self.subTest(reason=reason):
                calls, records = self.exercise('failed',reason)
                self.assertEqual(calls, ['request_0', 'request_1'])
                self.assertTrue(all(record['attempted'] for record in records))
                self.assertTrue(all(not record['grade']['task_success'] for record in records))
                calls,records=self.exercise('failed',reason,critical=True)
                self.assertEqual(calls,['request_0'])
                self.assertEqual(records[0]['protocol_halt_reason'],'critical_evidence_failure')
                self.assertFalse(records[1]['attempted'])

    def test_rejected_model_actions_with_known_accounting_are_scored_failures(self):
        # Each category is thrown only after a completed generation, from service.ts
        # patch/proposal validation or gateway-provider.ts step accounting.
        sources = "".join((ROOT / "services/audio-assistant/agent/lib" / name).read_text() for name in ("service.ts", "gateway-provider.ts"))
        thrown = set(re.findall(r"throw (?:new )?Error\(['\"]([a-z_]+)['\"]\)", sources))
        scored = {"unauthorized_parameter", "topology_change_forbidden", "duplicate_parameter",
                  "numeric_claim_requires_structured_evidence", "evaluated_preview_required", "forged_evidence",
                  "proposal_binding", "render_limit", "tool_call_limit", "token_budget_reservation"}
        self.assertTrue(scored <= thrown)
        for reason in sorted(scored):
            with self.subTest(reason=reason):
                calls, records = self.exercise("failed", reason, accounting_known=True)
                self.assertEqual(calls, ["request_0", "request_1"])
                self.assertNotIn("protocol_halt_reason", records[0])
                self.assertFalse(records[0]["grade"]["task_success"])
                for known in (False, None):
                    calls, records = self.exercise("failed", reason, accounting_known=known)
                    self.assertEqual(calls, ["request_0"])
                    self.assertEqual(records[0]["protocol_halt_reason"], reason)
                calls, records = self.exercise("failed", reason, critical=True, accounting_known=True)
                self.assertEqual(calls, ["request_0"])
                self.assertEqual(records[0]["protocol_halt_reason"], "critical_evidence_failure")
        for reason in ("invalid_render_cost", "stale_session", "cross_session", "invalid_preview", "provider_model_mismatch",
                       "currency_budget_reservation", "live_not_authorized", "token_limit", "cost_limit", "future_model_category"):
            with self.subTest(reason=reason):
                calls, records = self.exercise("failed", reason, accounting_known=True)
                self.assertEqual(calls, ["request_0"])
                self.assertEqual(records[0]["protocol_halt_reason"], reason)

    def stall_output(self, request, envelope_line=False, **changes):
        diagnostic = {"schema_version": 1, "request_id": request["request_id"], "elapsed_ms": 68004,
                      "ledger_step": "lock_owner_sync", "output_written": envelope_line,
                      "active_resources": {"FSReqPromise": 1, "Timeout": 2}}
        diagnostic.update(changes)
        line = json.dumps({"schema_version": 1, "request_sha256": request_digest(request),
                           "collector_stall_diagnostic": diagnostic})
        return ('{"result": "earlier line"}\n' if envelope_line else "") + line + "\n"

    def test_stall_diagnostic_is_retained_and_the_attempt_still_halts(self):
        for envelope_line in (False, True):
            with self.subTest(envelope_line=envelope_line):
                calls, records = self.exercise("noop", None, stall=lambda request: self.stall_output(request, envelope_line))
                self.assertEqual(calls, ["request_0"])
                self.assertEqual(records[0]["reason"], "invalid_or_missing_attempt_evidence")
                self.assertTrue(records[0]["grade"]["critical"])
                self.assertEqual(records[0]["collector_stall_diagnostic"]["ledger_step"], "lock_owner_sync")
                self.assertEqual(records[0]["collector_stall_diagnostic"]["active_resources"], {"FSReqPromise": 1, "Timeout": 2})
                self.assertNotIn("envelope", records[0])

    def test_stall_diagnostic_with_content_or_wrong_binding_is_never_retained(self):
        cases = {
            "extra_field": lambda r: self.stall_output(r, text="PRIVATE_DIAGNOSTIC_CANARY"),
            "free_step": lambda r: self.stall_output(r, ledger_step="PRIVATE canary"),
            "free_resource": lambda r: self.stall_output(r, active_resources={"PRIVATE canary": 1}),
            "other_request": lambda r: self.stall_output({**r, "request_id": "request_9"}),
            "not_json": lambda r: "PRIVATE_DIAGNOSTIC_CANARY\n",
            "empty": lambda r: "",
        }
        for name, stall in cases.items():
            with self.subTest(name=name):
                calls, records = self.exercise("noop", None, stall=stall)
                self.assertEqual(calls, ["request_0"])
                self.assertNotIn("collector_stall_diagnostic", records[0])
                self.assertNotIn("PRIVATE", json.dumps(records))
                self.assertEqual(records[0]["reason"], "invalid_or_missing_attempt_evidence")

    def diagnostic(self, **changes):
        value = {"schema_version": 1, "category": "json_invalid", "generation": 2, "finish_reason": "stop",
                 "byte_length": 812, "starts_with_brace": True, "ends_with_brace": True, "has_code_fence": False,
                 "top_level_json_values": 2, "trailing_unparsed_bytes": 0, "schema_issues": []}
        value.update(changes)
        return value

    def test_content_free_output_diagnostic_is_retained_beside_the_envelope(self):
        calls, records = self.exercise("failed", "provider_output_json_invalid_accounting_reserved", diagnostic=self.diagnostic())
        self.assertEqual(calls, ["request_0", "request_1"])
        self.assertEqual(records[0]["provider_output_diagnostic"]["top_level_json_values"], 2)
        self.assertNotIn("provider_output_diagnostic", records[0]["envelope"])
        schema = self.diagnostic(category="schema_invalid", schema_issues=[{"path": ["action", "kind"], "code": "invalid_union"}])
        calls, records = self.exercise("failed", "provider_output_schema_invalid_accounting_reserved", diagnostic=schema)
        self.assertEqual(records[0]["provider_output_diagnostic"]["schema_issues"][0]["path"], ["action", "kind"])

    def test_output_diagnostic_with_content_or_wrong_binding_is_never_retained(self):
        for name, diagnostic, reason in (
                ("extra_field", self.diagnostic(text="PRIVATE_DIAGNOSTIC_CANARY"), "provider_output_json_invalid_accounting_reserved"),
                ("free_path", self.diagnostic(category="schema_invalid", schema_issues=[{"path": ["PRIVATE canary"], "code": "custom"}]), "provider_output_schema_invalid_accounting_reserved"),
                ("category_mismatch", self.diagnostic(), "provider_output_schema_invalid_accounting_reserved"),
                ("not_output_failure", self.diagnostic(), "provider_step_limit")):
            with self.subTest(name=name):
                calls, records = self.exercise("failed", reason, diagnostic=diagnostic)
                self.assertEqual(calls, ["request_0"])
                self.assertNotIn("provider_output_diagnostic", records[0])
                self.assertNotIn("PRIVATE", json.dumps(records))
                self.assertEqual(records[0]["reason"], "invalid_or_missing_attempt_evidence")

if __name__ == "__main__":
    unittest.main()
