"""Protocol and grader tests; no live-model or rendered-audio qualification."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "evals"))
from ai import grade, grade_proposal, response_for, seed_tasks, clustered_interval
from dataset import assigned_split, canonical_hash, signal_signature, validate_inventory


class AIEvaluatorTests(unittest.TestCase):
    def test_rules_protocol_and_no_assistant_baseline(self):
        for task in seed_tasks():
            self.assertTrue(grade(task, response_for(task))["pass"], task["task_id"])
        task = seed_tasks()[0]
        self.assertFalse(grade(task, response_for(task, "no-assistant"))["pass"])

    def test_critical_grader_mutations(self):
        task = seed_tasks()[0]
        mutations = {}
        for key, value in (("source_sha256", "f"*64), ("base_graph_sha256", "e"*64),
                           ("session_revision", 6), ("request_id", "forged"),
                           ("selection_samples", [0,1]), ("requires_user_acceptance", False)):
            response = response_for(task)
            response["proposal"][key] = value
            mutations[key] = response
        for name, key, value in (("unknown-id", "measurement_id", "forged"), ("wrong-value", "value", 999), ("wrong-unit", "unit", "Hz")):
            response = response_for(task)
            response["proposal"]["evidence_refs"][0][key] = value
            mutations[name] = response
        for name, key, value in (("path", "stage_id", "../../secrets"), ("apply", "parameter_id", "apply"),
                                 ("nonfinite", "value", float("nan")), ("coercion", "value", True),
                                 ("range", "value", -99), ("parameter-unit", "unit", "Hz")):
            response = response_for(task)
            response["proposal"]["parameter_patch"][0][key] = value
            mutations[name] = response
        for name, response in mutations.items():
            self.assertFalse(grade(task, response)["pass"], name)
        # An ablated validation function must fail this mutation-detection test.
        self.assertTrue(all(grade(task, r)["critical"] for r in mutations.values()))

    def test_noop_abstention_and_budget_fail_closed(self):
        for task in seed_tasks()[1:9]:
            response = response_for(task)
            response["preview"] = {"fabricated":"success"}
            self.assertFalse(grade(task, response)["pass"])
        task = seed_tasks()[0]
        for change in ({"tool_calls":2}, {"cost_usd":float("inf")}, {"latency_ms":-1}):
            response = response_for(task)
            response["usage"].update(change)
            self.assertFalse(grade(task, response)["pass"])

    def test_clustered_repetitions_not_independent(self):
        records = [{"task_id":"a","score":1}, {"task_id":"b","score":0}]
        self.assertEqual(clustered_interval(records), clustered_interval(records*3))
        self.assertEqual(clustered_interval(records)["clusters"], 2)

    def test_frozen_corpus_manifest(self):
        root = Path(__file__).resolve().parents[2] / "evals/datasets"
        pinned = json.loads((root / "manifest-lock.json").read_text())
        for name, digest in pinned.items():
            manifest = json.loads((root / name).read_text())
            self.assertEqual(canonical_hash(manifest), digest)
            self.assertEqual(validate_inventory(manifest), [])
        # This is a seed regression corpus. No final unseen-holdout claim.
        manifest = json.loads((root / "seed-inventory.json").read_text())
        self.assertFalse(manifest["holdout_qualified"])

    def test_grouped_leakage_and_normalized_duplicates(self):
        self.assertEqual(signal_signature([.1,.2,-.3]), signal_signature([-.2,-.4,.6]))
        groups = {}
        for i in range(100):
            groups.setdefault(assigned_split(str(i)), str(i))
        items = [{"id":str(i),"parent_group":group,"split":split,"sha256":"same","duplicate_signature":"same","license":"CC0"}
                 for i,(split,group) in enumerate(groups.items())]
        self.assertTrue(any("duplicate leakage" in e for e in validate_inventory({"schema_version":1,"items":items})))


if __name__ == "__main__":
    unittest.main()
