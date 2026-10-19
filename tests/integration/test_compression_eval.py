"""Frozen compression experiment contracts, kept separate from level corpus."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals"))
from compression_eval import registry
from compression_tasks import canonical_hash, fixture_samples, load_corpus
from level_eval import load_captures
from oracles import sha256, write_float_wav


class CompressionExperimentContracts(unittest.TestCase):
    def test_frozen_sources_and_experiment(self):
        corpus = load_corpus()
        self.assertEqual(len(corpus["tasks"]), 16)
        self.assertEqual(len(corpus["fixtures"]), 6)
        self.assertEqual(corpus["model_repetitions"], 3)
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            for name, spec in corpus["fixtures"].items():
                path = Path(tmp) / (name + ".wav")
                write_float_wav(path, fixture_samples(spec), corpus["sample_rate"])
                self.assertEqual(sha256(path), spec["sha256"])

    def test_prompt_or_gate_mutation_rejected(self):
        for change in (lambda c: c["tasks"][0].update(prompt="changed"), lambda c: c["tasks"][0]["tolerances"].update(contrast_db=2)):
            corpus = copy.deepcopy(load_corpus())
            change(corpus)
            with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
                path = Path(tmp) / "corpus.json"
                path.write_text(json.dumps(corpus))
                with self.assertRaisesRegex(ValueError, "digest mismatch"):
                    load_corpus(path)

    def test_only_threshold_is_editable(self):
        for task in load_corpus()["tasks"]:
            controls = registry(task)
            editable = [c for c in controls if c["min"] != c["max"]]
            self.assertEqual(len(editable), 1)
            self.assertEqual((editable[0]["stage_id"], editable[0]["parameter_id"], editable[0]["unit"]), ("compressor", "thresholdDb", "dBFS"))
            self.assertEqual(editable[0]["value"], task["parameters"]["thresholdDb"])

    def test_captures_cannot_cross_corpus_or_select_paid_arm(self):
        corpus = load_corpus()
        value = {"schema_version": 1, "corpus_sha256": canonical_hash(corpus), "records": [{"task_id": "reduce-three", "arm": "tool-grounded", "repeat": 0,
                 "capture": {"schema_version": 1, "provenance": {"kind": "scripted-test", "model": "none"}, "actions": [{"kind": "abstain", "input": {"reason": "offline"}}]}}]}
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            path = Path(tmp) / "capture.json"
            path.write_text(json.dumps(value))
            self.assertEqual(len(load_captures(path, corpus)), 1)
            value["records"][0]["arm"] = "paid-live"
            path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                load_captures(path, corpus)
            value["corpus_sha256"] = "0" * 64
            path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                load_captures(path, corpus)


if __name__ == "__main__":
    unittest.main()
