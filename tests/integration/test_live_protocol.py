"""The infrastructure protocol fails closed on drift before work can advance."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals"))
from live_protocol import PROTOCOL, SPEC, validate, production_limits


class LiveProtocolTests(unittest.TestCase):
    def test_current_protocol_matches_production_and_locked_corpora(self):
        result = validate()
        self.assertEqual(result["scored_requests"], 168)
        self.assertEqual(result["maximum_requests"], 180)
        self.assertIs(result["live_authorized"], False)

    def test_mutations_cannot_silently_change_frozen_contract(self):
        baseline = json.loads(PROTOCOL.read_text())
        mutations = [
            ("limits", "wall_ms", 120000),
            ("schedule", "repetitions", 1),
            ("claim_gates", "level_success", 0.5),
            ("claim_gates", "all_negative_decisions_correct", False),
            ("claim_gates", "invalid_audio_accepted", 1),
            ("claim_gates", "partial_run_claims", True),
            ("audio_gates", "gain_max_sample_error", 0.01),
            ("stages", "P3", ["P0"]),
        ]
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            path = Path(tmp) / "protocol.json"
            for section, key, replacement in mutations:
                with self.subTest(section=section, key=key):
                    mutated = copy.deepcopy(baseline)
                    mutated[section][key] = replacement
                    path.write_text(json.dumps(mutated))
                    with self.assertRaisesRegex(ValueError, "digest mismatch"):
                        validate(path)
            baseline["live_authorized"] = True
            path.write_text(json.dumps(baseline))
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                validate(path)

    def test_duplicate_or_missing_stages_fail(self):
        raw = PROTOCOL.read_text()
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            path = Path(tmp) / "protocol.json"
            path.write_text(raw.replace('"P0": []', '"P0": [], "P0": []'))
            with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
                validate(path)
            value = json.loads(raw)
            del value["stages"]["P2"]
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                validate(path)

    def test_prose_only_contract_drift_fails(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            spec = Path(tmp) / "protocol.md"
            spec.write_text("Changed cancellation, recovery or authorization requirement.")
            with patch("live_protocol.SPEC", spec):
                with self.assertRaisesRegex(ValueError, "specification digest mismatch"):
                    validate()

    def test_windows_checkout_newlines_preserve_spec_identity(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            spec = Path(tmp) / "protocol.md"
            spec.write_bytes(SPEC.read_text(encoding="utf-8").replace("\n", "\r\n").encode("utf-8"))
            with patch("live_protocol.SPEC", spec):
                self.assertEqual(validate()["status"], "passed")

    def test_spread_follows_production_import_and_override_order(self):
        source = "import {LIVE_LIMITS} from './live-policy.ts';\nexport const LIMITS=Object.freeze({request_bytes:8192,...LIVE_LIMITS});"
        policy = "export const LIVE_LIMITS=Object.freeze({wall_ms:60000,tool_calls:8});"
        self.assertEqual(production_limits(source, policy)["wall_ms"], 60000)
        changed = source.replace("...LIVE_LIMITS}", "...LIVE_LIMITS,wall_ms:120000}")
        self.assertEqual(production_limits(changed, policy)["wall_ms"], 120000)
        with self.assertRaisesRegex(ValueError, "import unavailable"):
            production_limits(source.replace("./live-policy.ts", "./other.ts"), policy)
        with self.assertRaisesRegex(ValueError, "unsupported"):
            production_limits(source, policy.replace("wall_ms:60000", "wall_ms:60000*2"))

    def test_changed_spread_registry_fails_real_gate(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            root = Path(tmp)
            lib = root / "services/audio-assistant/agent/lib"
            lib.mkdir(parents=True)
            (lib / "service.ts").write_text("import {LIVE_LIMITS} from './live-policy.ts';\nexport const LIMITS=Object.freeze({...LIVE_LIMITS});")
            limits = json.loads(PROTOCOL.read_text())["limits"]
            registry = lambda: "export const LIVE_LIMITS=Object.freeze({" + ",".join(f"{key}:{value}" for key, value in limits.items()) + "});"
            (lib / "live-policy.ts").write_text(registry())
            with patch("live_protocol.ROOT", root):
                self.assertEqual(validate()["status"], "passed")
                limits["wall_ms"] = 120000
                (lib / "live-policy.ts").write_text(registry())
                with self.assertRaisesRegex(ValueError, "production limits drift"):
                    validate()


if __name__ == "__main__":
    unittest.main()

