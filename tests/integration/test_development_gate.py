import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "evals"))
from check_development import check, current_identity


class DevelopmentGateTests(unittest.TestCase):
    def test_expected_block_is_preserved_and_failures_cannot_be_masked(self):
        fixture_root = Path(__file__).resolve().parents[2] / "artifacts/test-tmp"
        fixture_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=fixture_root) as folder:
            root = Path(folder)
            asset = root / "replay.json"
            asset.write_text("{}")
            evidence = [{"path": "replay.json", "sha256": hashlib.sha256(asset.read_bytes()).hexdigest()}]
            valid = {"schema_version": 1, "suite": "ai-replay", "split": "development", "status": "blocked",
                     "source_unchanged": True, "runtime_unchanged": True, "results": [
                         {"case_id": "AI-PROTOCOL-BASELINES", "status": "pass", "evidence_paths": evidence},
                         {"case_id": "AI-LIVE-QUALIFICATION-PENDING", "status": "blocked"}]}
            valid.update(current_identity())
            path = root / "run.json"
            path.write_text(json.dumps(valid))
            self.assertEqual(check(path), {"development_protocol_gate": "pass", "live_qualification": "blocked", "release_qualified": False})
            mutants = []
            for field in ("commit_sha", "source_identity_sha256", "gates_sha256", "runner_sha256", "oracle_sha256"):
                mutant = copy.deepcopy(valid); mutant[field] = "stale"; mutants.append(mutant)
            mutant = copy.deepcopy(valid); mutant["runtime_files"] = []; mutants.append(mutant)
            for field, value in (("status", "pass"), ("suite", "ai-live"), ("split", "locked-test"), ("source_unchanged", False), ("runtime_unchanged", False)):
                mutant = copy.deepcopy(valid); mutant[field] = value; mutants.append(mutant)
            for status in ("fail", "blocked"):
                mutant = copy.deepcopy(valid); mutant["results"][0]["status"] = status; mutants.append(mutant)
            mutants += [dict(valid, results=valid["results"][:1]), dict(valid, results=valid["results"] * 2)]
            mutant = copy.deepcopy(valid); mutant["results"][1]["case_id"] = "UNEXPECTED-BLOCK"; mutants.append(mutant)
            for mutant in mutants:
                path.write_text(json.dumps(mutant))
                with self.assertRaises(ValueError): check(path)
            path.write_text(json.dumps(valid)); asset.write_text("tampered")
            with self.assertRaises(ValueError): check(path)
