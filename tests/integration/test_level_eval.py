"""Experiment contracts: locked tasks, bounded captures, honest paired scoring."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals"))
from level_eval import decision_context, load_captures, summarize, record_baseline_failure
from level_tasks import ARMS, canonical_hash, fixture_samples, load_corpus, strict_json
from oracles import sha256, write_float_wav


class LevelExperimentContracts(unittest.TestCase):
    def test_shared_baseline_failure_retains_all_scheduled_records(self):
        task = load_corpus()["tasks"][0]
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            out = Path(tmp)
            folder = out / "case"
            folder.mkdir()
            rows = record_baseline_failure(out, folder, task, 3, {}, "native_failed")
            self.assertEqual(len(rows), 11)
            stats = summarize(rows)["arms"]
            self.assertEqual(stats["rules"]["scheduled_records"], 1)
            self.assertEqual(stats["rules"]["feasible_tasks"], 1)
            self.assertEqual(stats["rules"]["runtime_failures"], 1)
            self.assertEqual(stats["rules"]["feasible_task_cluster_interval"]["estimate"], 0)
            self.assertEqual(stats["tool-grounded"]["blocked_records"], 3)
            self.assertTrue(all((out / r["record_path"]).is_file() for r in rows))

    def test_frozen_source_bytes_and_experiment(self):
        corpus = load_corpus()
        self.assertEqual(len(corpus["tasks"]), 24)
        self.assertEqual(len(corpus["fixtures"]), 6)
        self.assertEqual(corpus["arms"], list(ARMS))
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            for name, spec in corpus["fixtures"].items():
                path = Path(tmp) / (name + ".wav")
                write_float_wav(path, fixture_samples(spec, corpus["frames"]), corpus["sample_rate"])
                self.assertEqual(sha256(path), spec["sha256"], name)

    def test_changed_task_rejected_by_lock(self):
        corpus = load_corpus()
        corpus["tasks"][0]["prompt"] += " changed"
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            path = Path(tmp) / "tasks.json"
            path.write_text(json.dumps(corpus))
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                load_corpus(path)

    def test_json_rejects_duplicate_and_nonfinite_values(self):
        for raw in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', '{"a":[1e999]}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                strict_json(raw)

    def capture_file(self, folder, records):
        path = Path(folder) / "capture.json"
        path.write_text(json.dumps({"schema_version": 1, "corpus_sha256": canonical_hash(load_corpus()), "records": records}))
        return path

    def record(self):
        return {"task_id": load_corpus()["tasks"][0]["task_id"], "arm": "single-model-no-tools", "repeat": 0,
                "capture": {"schema_version": 1, "provenance": {"kind": "scripted-test", "model": "none"},
                            "actions": [{"kind": "noop", "input": {}}]}}

    def test_captures_are_bound_unique_and_bounded(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            record = self.record()
            self.assertEqual(len(load_captures(self.capture_file(tmp, [record]), load_corpus())), 1)
            with self.assertRaisesRegex(ValueError, "duplicate"):
                load_captures(self.capture_file(tmp, [record, record]), load_corpus())
            for change in ({"repeat": True}, {"repeat": 3}, {"arm": "paid-live"}, {"task_id": "unknown"}):
                altered = {**record, **change}
                with self.subTest(change=change), self.assertRaises(ValueError):
                    load_captures(self.capture_file(tmp, [altered]), load_corpus())
            altered = copy.deepcopy(record)
            altered["capture"]["actions"] *= 9
            with self.assertRaises(ValueError):
                load_captures(self.capture_file(tmp, [altered]), load_corpus())
            path = self.capture_file(tmp, [record])
            data = json.loads(path.read_text())
            data["corpus_sha256"] = "0" * 64
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                load_captures(path, load_corpus())

    def test_context_does_not_leak_evaluator_answers_and_hides_measurements(self):
        task = load_corpus()["tasks"][0]
        baseline = {"rms_dbfs": 0., "peak_dbfs": None}
        context = decision_context({"prompt": task["prompt"]}, {"parameters": []}, baseline, task, "tool-grounded")
        self.assertEqual(context["measurements"][0]["value"], 0.)
        self.assertEqual(context["measurements"][1]["value"], -240.)
        for key in ("expected_status", "objective", "fixture_id", "tolerances"):
            self.assertNotIn(key, context)
        hidden = decision_context({}, {"parameters": [{"value": 0}]}, baseline, task, "grounding-disabled")
        self.assertFalse(hidden["measurements"]["available"])
        self.assertEqual(hidden["snapshot"]["parameters"][0]["value"], 0)

    def test_blocked_models_have_no_success_or_usage_and_repeats_cluster(self):
        rows = []
        for arm, repeat, success in (("no-assistant", 0, False), ("rules", 0, True),
                                     ("tool-grounded", 0, True), ("tool-grounded", 1, False), ("tool-grounded", 2, True)):
            rows.append({"task_id": "one", "arm": arm, "repeat": repeat, "expected_status": "ready", "status": "completed",
                         "grade": {"task_success": success, "decision_success": True, "critical": False}})
        rows.append({"task_id": "one", "arm": "single-model-no-tools", "repeat": 0, "status": "blocked", "grade": None})
        stats = summarize(rows)
        blocked = stats["arms"]["single-model-no-tools"]
        self.assertEqual(blocked["blocked_records"], 1)
        self.assertEqual(blocked["task_successes"], 0)
        self.assertEqual(blocked["actual_model_calls"], 0)
        self.assertIsNone(blocked["feasible_task_cluster_interval"]["estimate"])
        interval = stats["arms"]["tool-grounded"]["feasible_task_cluster_interval"]
        self.assertEqual(interval["clusters"], 1)
        self.assertAlmostEqual(interval["estimate"], 2 / 3)
        self.assertEqual(stats["paired_feasible_rules_minus_unchanged"]["estimate"], 1)
        self.assertAlmostEqual(stats["paired_feasible_capture_comparisons"]["tool-grounded_minus_rules"]["estimate"], -1 / 3)

    def test_infrastructure_failure_remains_in_denominator(self):
        rows = [{"task_id": "one", "arm": "rules", "repeat": 0, "expected_status": "ready", "status": "completed",
                 "grade": {"task_success": True, "decision_success": True, "critical": False}},
                {"task_id": "two", "arm": "rules", "repeat": 0, "expected_status": "ready", "status": "failed", "grade": None}]
        stats = summarize(rows)["arms"]["rules"]
        self.assertEqual(stats["feasible_tasks"], 2)
        self.assertEqual(stats["runtime_failures"], 1)
        self.assertEqual(stats["infrastructure_failures"], 1)
        self.assertEqual(stats["feasible_task_cluster_interval"]["estimate"], .5)
        rows[1]["expected_status"] = "abstain"
        stats = summarize(rows)["arms"]["rules"]
        self.assertEqual(stats["boundary_tasks"], 1)
        self.assertEqual(stats["correct_boundary_decisions"], 0)


if __name__ == "__main__":
    unittest.main()
