"""Tests of independent oracles and fail-closed evidence validation."""
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "evals"))
from oracles import (compressor_gain_db, fixture, flatten, read_wav, residual,
                     rms, sha256, write_float_wav)
from release_check import REQUIRED, validate_manifest
from run import Runner


class OracleTests(unittest.TestCase):
    def test_rms_analytic(self):
        self.assertEqual(rms([1, -1, 1, -1]), 1)
        self.assertEqual(rms([0, 0]), 0)
        self.assertAlmostEqual(rms([3, 4]), math.sqrt(12.5))

    def test_compressor_math(self):
        self.assertEqual(compressor_gain_db(-30, -18, 4), 0)
        self.assertEqual(compressor_gain_db(-18, -18, 4), 0)
        self.assertEqual(compressor_gain_db(-6, -18, 4), -9)
        self.assertAlmostEqual(compressor_gain_db(-18, -18, 4, 6), -.5625)
        self.assertEqual(compressor_gain_db(0, -18, 1, 6), 0)

    def test_float_roundtrip_and_hash(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            path = Path(tmp) / "fixture.wav"
            source = fixture("noise", frames=31)
            write_float_wav(path, source)
            rate, actual = read_wav(path)
            self.assertEqual(rate, 48000)
            self.assertEqual([len(c) for c in actual], [31, 31])
            self.assertLess(residual(flatten(source), flatten(actual))["max_abs"], 2e-8)
            self.assertEqual(len(sha256(path)), 64)
            path.write_bytes(path.read_bytes()[:-1])
            with self.assertRaises(ValueError):
                read_wav(path)

    def test_nonfinite_rejected_by_independent_reader(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            path = Path(tmp) / "bad.wav"
            write_float_wav(path, [[float("nan")]])
            with self.assertRaises(ValueError):
                read_wav(path)

    def test_numerical_mutations_detected(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            detected = Runner.mutation(None, Path(tmp))
            self.assertEqual(set(detected), {"gain_factor", "one_sample_delay", "channel_swap", "rms_normalization"})
            self.assertTrue(all(detected.values()))

    def test_unavailable_cli_has_hashed_blocked_evidence(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            runner = Runner(SimpleNamespace(output=tmp, cli=None, suite="contracts"))
            runner.case("NO-CLI", ["IO-DECODE"], ["TS-001"], runner.inspect)
            result = runner.results[0]
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["fixture_sha256"], sha256(Path(tmp) / "NO-CLI/input.wav"))
            self.assertIsNone(result["artifact_sha256"])
            self.assertTrue(result["evidence_paths"])


class ReleaseTests(unittest.TestCase):
    def check(self, data):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            path = Path(tmp) / "manifest.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            return validate_manifest(path)

    def test_empty_manifest_is_not_release(self):
        errors = self.check({})
        self.assertEqual(len(errors), len(REQUIRED))

    def test_prose_assertion_is_not_evidence(self):
        errors = self.check({"all_checks": "passed", "reviewer_decisions": "approved"})
        self.assertTrue(errors)
        self.assertTrue(any("reviewer_decisions" in e for e in errors))

    def test_wrong_top_level_types_fail(self):
        self.assertEqual(self.check([]), ["manifest must be an object"])

    def test_typed_empty_manifest_still_fails_closed(self):
        data = {field: kind() for field, kind in REQUIRED.items()}
        data.update(schema_version=1, product="ToneScope", version="0.1", edition="D2",
                    commit_sha="0" * 40, installation_instructions="install", rollback_instructions="rollback")
        errors = self.check(data)
        for text in ("dependency inventory", "manual qualification", "reviewer approval", "required_suites", "shipped_requirements", "critical contract"):
            self.assertTrue(any(text in e for e in errors), (text, errors))

    def test_structural_release_fixture_and_tampering(self):
        # An ephemeral validator fixture, never real release or qualification evidence.
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            base = Path(tmp)

            def ref(name, data):
                path = base / name
                path.write_text(json.dumps(data), encoding="utf-8")
                return {"path": name, "sha256": sha256(path)}

            payload = ref("payload.json", {"fixture_only": True})
            commit = "a" * 40
            case = {"schema_version": 1, "case_id": "TEST-ONLY", "commit_sha": commit,
                    "status": "pass", "run_id": "fixture", "oracle_version": "unit_test_only",
                    "measurements": {"max_error": 0}, "evidence_paths": [payload],
                    "families": ["EXPORT-ROUNDTRIP", "EXPORT-PROVENANCE"]}
            runs = []
            for suite in ("contracts", "dsp", "integration"):
                case["suite"] = suite
                runs.append(ref(suite + ".json", {"schema_version": 1, "suite": suite,
                    "status": "pass", "commit_sha": commit, "run_id": "fixture", "working_tree_dirty": False,
                    "cli_sha256": "b" * 64, "runner_sha256": "c" * 64, "oracle_sha256": "d" * 64,
                    "results": [case]}))
            manual = [ref(kind + ".json", {"schema_version": 1, "kind": kind, "record_id": "fixture",
                       "status": "pass", "operator": "unit test", "date": "2000-01-01",
                       "profile_id": "fixture", "observations": {"test_only": True}})
                      for kind in ("hardware", "listening", "accessibility", "installation")]
            manifest = {key: kind() for key, kind in REQUIRED.items()}
            manifest.update(schema_version=1, product="unit test fixture", version="0", edition="D2",
                            commit_sha=commit, unsigned_payload=payload, packaged_artifact=payload,
                            toolchain={"name": "test", "version": "0"}, dsp_generator={"name": "test", "version": "0"},
                            dependencies=[{"name": "test", "version": "0", "sha256": "e" * 64, "license": "test"}],
                            supported_profiles=[payload], required_suites=runs, holdout_manifests=[payload],
                            manual_qualification=manual, notices=payload, sbom=payload,
                            signature={"status": "verified", "evidence": payload}, attestation={"status": "verified", "evidence": payload},
                            reviewer_decisions=[{"reviewer": "unit test", "decision": "approve", "date": "2000-01-01", "commit_sha": commit}],
                            installation_instructions="fixture", rollback_instructions="fixture", shipped_requirements=["TS-013"],
                            critical_contract_boundaries=[{"id": "fixture", "case_ids": ["TEST-ONLY"]}])
            path = base / "manifest.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            errors = validate_manifest(path)
            for expected in ("exact checkout HEAD", "distinct evidence", "runtime files", "source identity", "frozen required cases"):
                self.assertTrue(any(expected in e for e in errors), (expected, errors))
            suite_data = json.loads((base / "contracts.json").read_text())
            suite_data["results"][0]["measurements"] = "everything passed"
            manifest["required_suites"][0] = ref("contracts.json", suite_data)
            path.write_text(json.dumps(manifest), encoding="utf-8")
            self.assertTrue(any("measurements" in error for error in validate_manifest(path)))
            (base / "payload.json").write_text("tampered", encoding="utf-8")
            self.assertTrue(any("hash mismatch" in error for error in validate_manifest(path)))


if __name__ == "__main__":
    unittest.main()

