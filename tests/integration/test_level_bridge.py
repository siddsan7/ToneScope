"""Offline bridge tests use the actual service and native renderer; no model calls."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals"))
from oracles import read_wav, rms, sha256, write_float_wav

RUNTIME = Path(os.environ.get("TONESCOPE_ASSISTANT_RUNTIME", str(ROOT / "services/audio-assistant")))
CLI = Path(os.environ.get("TONESCOPE_TEST_CLI", str(ROOT / "build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe")))
AVAILABLE = CLI.is_file() and (RUNTIME / "agent/lib/service.ts").is_file() and (RUNTIME / "node_modules/zod/package.json").is_file()
if os.environ.get("TONESCOPE_REQUIRE_NATIVE_TESTS") == "1" and not AVAILABLE:
    raise RuntimeError("Required native level bridge dependencies are missing")


@unittest.skipUnless(AVAILABLE, "built CLI and installed assistant runtime required")
class LevelBridgeEvaluation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / "artifacts").mkdir(exist_ok=True)
    def fixture(self, folder, arm="rules", actions=None):
        source, baseline = folder / "source.wav", folder / "baseline.wav"
        frames, rate = 4800, 48000
        write_float_wav(source, [[.05 * math.sin(2 * math.pi * 440 * n / rate) for n in range(frames)]], rate)
        manifest = json.loads(subprocess.run([str(CLI), "render", "--source", str(source), "--out", str(baseline)], capture_output=True, text=True, check=True, timeout=30).stdout)
        snapshot = {"session_id": "level_session", "session_revision": 3, "source_sha256": sha256(source), "base_graph_sha256": manifest["graph_sha256"], "source_handle": "host_owned", "selection_samples": [0, frames], "sample_rate": rate, "parameters": [{"stage_id": "output", "parameter_id": "outputDb", "unit": "dB", "value": 0, "min": -24, "max": 24}]}
        fixture = {"schema_version": 1, "arm": arm, "request": {"schema_version": 1, "request_id": "level_request", "session_id": snapshot["session_id"], "prompt": "Please increase the level"}, "snapshot": snapshot, "asset": {"snapshot": snapshot, "source_path": str(source), "baseline_path": str(baseline), "parameters": {"outputDb": 0}}}
        if actions is not None:
            fixture["capture"] = {"schema_version": 1, "provenance": {"kind": "scripted-test", "model": "none"}, "actions": actions, "historical_usage": {"cost_usd": 12}}
        return fixture

    def run_bridge(self, folder, fixture):
        (folder / "bridge-input.json").write_text(json.dumps(fixture))
        env = {**os.environ, "TONESCOPE_ENABLE_LIVE": "1", "AI_GATEWAY_API_KEY": "deliberately-invalid-test-key"}
        result = subprocess.run(["node", "--experimental-strip-types", str(ROOT / "evals/level_bridge.mjs"), str(RUNTIME.resolve()), str(CLI.resolve()), str(folder.resolve())], capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output, json.loads((folder / "bridge-output.json").read_text()))
        self.assertEqual(output["decision_inputs_sha256"], sha256(folder / "decision-inputs.json"))
        return output

    @staticmethod
    def render_action(value=-3):
        return {"kind": "render_candidate", "input": {"parameter_patch": [{"stage_id": "output", "parameter_id": "outputDb", "unit": "dB", "value": value}]}}

    def test_actual_rules_baseline(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            folder = Path(tmp)
            output = self.run_bridge(folder, self.fixture(folder))
            self.assertEqual(output["status"], "completed", output)
            self.assertEqual(output["response"]["status"], "ready")
            preview = Path(output["preview_path"])
            self.assertEqual(sha256(preview), output["response"]["preview"]["audio_sha256"])
            ratio = rms(read_wav(preview)[1][0]) / rms(read_wav(folder / "baseline.wav")[1][0])
            self.assertAlmostEqual(20 * math.log10(ratio), 6, places=4)
            self.assertEqual(output["response"]["usage"]["cost_usd"], 0)

    def test_models_block_without_capture_despite_paid_environment(self):
        for arm in ("single-model-no-tools", "tool-grounded", "grounding-disabled"):
            with self.subTest(arm=arm), tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
                folder = Path(tmp)
                output = self.run_bridge(folder, self.fixture(folder, arm))
                self.assertEqual(output["status"], "blocked")
                self.assertIsNone(output["response"])
                self.assertIsNone(output["preview_path"])

    def test_one_shot_wrong_patch_is_rendered_without_claiming_success(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            folder = Path(tmp)
            output = self.run_bridge(folder, self.fixture(folder, "single-model-no-tools", [self.render_action()]))
            self.assertEqual(output["response"]["status"], "ready", output)
            self.assertEqual(output["response"]["proposal"]["parameter_patch"][0]["value"], -3)
            self.assertEqual(len(output["decision_inputs"]), 1)
            self.assertEqual(output["historical_usage"]["cost_usd"], 12)
            self.assertEqual(output["response"]["usage"]["cost_usd"], 0)
            self.assertTrue(output["evaluation_wrapper"])
            self.assertEqual(output["capture_classification"], "scripted-test-actions-unqualified")

    def test_strict_action_rejection_retains_raw_action(self):
        for mutate in (lambda a: a["input"].update({"command": "invalid"}), lambda a: a["input"]["parameter_patch"][0].update({"parameter_id": "compressor", "value": True})):
            with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
                folder = Path(tmp)
                action = self.render_action()
                mutate(action)
                output = self.run_bridge(folder, self.fixture(folder, "single-model-no-tools", [action]))
                self.assertEqual(output["status"], "failed", output)
                self.assertEqual(output["raw_actions"], [action])
                self.assertTrue(output["rejection_errors"])
                self.assertIsNone(output["preview_path"])

    def test_grounding_ablation_hides_audio_measurements_only(self):
        for arm in ("tool-grounded", "grounding-disabled"):
            with self.subTest(arm=arm), tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
                folder = Path(tmp)
                action = self.render_action()
                actions = [action, {"kind": "propose_change", "input": action["input"]}]
                output = self.run_bridge(folder, self.fixture(folder, arm, actions))
                self.assertEqual(output["response"]["status"], "ready", output)
                initial, feedback = output["decision_inputs"]
                self.assertEqual(initial["snapshot"]["parameters"][0]["value"], 0)
                if arm == "grounding-disabled":
                    self.assertFalse(initial["measurements"]["available"])
                    self.assertNotIn("measurements", feedback["preview"])
                    self.assertFalse(feedback["comparison"]["available"])
                else:
                    self.assertEqual(initial["measurements"][0]["measurement_id"], "rms_dbfs")
                    self.assertIn("measurements", feedback["preview"])

    def test_forged_terminal_evidence_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            folder = Path(tmp)
            fixture = self.fixture(folder, "tool-grounded", [])
            s = fixture["snapshot"]
            proposal = {"schema_version": 1, "request_id": "level_request", "session_revision": s["session_revision"], "source_sha256": s["source_sha256"], "base_graph_sha256": s["base_graph_sha256"], "selection_samples": s["selection_samples"], "hypotheses": ["Level changes."], "evidence_refs": [{"measurement_id": "rms_dbfs", "value": 9, "unit": "dBFS"}], "parameter_patch": self.render_action()["input"]["parameter_patch"], "expected_tradeoffs": ["Peak changes."], "limitations": ["Capture only."], "requires_user_acceptance": True}
            fixture["capture"]["actions"] = [self.render_action(), {"kind": "propose_change", "input": proposal}]
            output = self.run_bridge(folder, fixture)
            self.assertEqual(output["response"]["reason"], "forged_evidence", output)
            self.assertEqual(output["raw_actions"][1]["input"], proposal)

    def test_two_candidates_pass_and_third_is_rejected(self):
        for count in (2, 3):
            with self.subTest(count=count), tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
                folder = Path(tmp)
                actions = [self.render_action(-n) for n in range(1, count + 1)]
                actions.append({"kind": "propose_change", "input": actions[-1]["input"]})
                output = self.run_bridge(folder, self.fixture(folder, "tool-grounded", actions))
                if count == 2:
                    self.assertEqual(output["response"]["status"], "ready", output)
                    self.assertEqual(output["response"]["usage"]["tool_calls"], 7)
                    artifacts = [step["artifact"] for step in output["tool_trace"] if step["kind"] == "render_candidate" and "artifact" in step]
                    self.assertEqual(len(artifacts), 2)
                    for artifact in artifacts:
                        self.assertEqual(sha256(Path(artifact["path"])), artifact["sha256"])
                        self.assertTrue(Path(artifact["sidecar_path"]).is_file())
                else:
                    self.assertEqual(output["response"]["reason"], "evaluation_candidate_limit", output)
                    self.assertIsNone(output["preview_path"])

    def test_host_rejects_request_and_source_identity_mismatch(self):
        for mismatch in ("session", "source"):
            with self.subTest(mismatch=mismatch), tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
                folder = Path(tmp)
                fixture = self.fixture(folder)
                if mismatch == "session":
                    fixture["request"]["session_id"] = "other_session"
                else:
                    with (folder / "source.wav").open("ab") as stream:
                        stream.write(b"changed")
                output = self.run_bridge(folder, fixture)
                self.assertEqual(output["status"], "failed", output)
                self.assertIsNone(output["preview_path"])


if __name__ == "__main__":
    unittest.main()
