"""Actual-native generalization outside the frozen level corpus.

Different sample rates, deterministic noise/pulses, numeric forms and initial
gains. Expectations use independent WAV measurements, never service metrics.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals"))
from level_audio import grade_audio, measure_audio
from oracles import sha256, write_float_wav

CLI = Path(os.environ.get("TONESCOPE_TEST_CLI", ROOT / "build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe"))
RUNTIME = Path(os.environ.get("TONESCOPE_ASSISTANT_RUNTIME", ROOT / "services/audio-assistant"))
AVAILABLE = CLI.is_file() and (RUNTIME / "node_modules/zod/package.json").is_file()
if os.environ.get("TONESCOPE_REQUIRE_NATIVE_TESTS") == "1" and not AVAILABLE:
    raise RuntimeError("Required native rules generalization dependencies missing")


@unittest.skipUnless(AVAILABLE, "built CLI and installed assistant runtime required")
class NativeRulesGeneralization(unittest.TestCase):
    def check_case(self, prompt, objective, status="ready", *, current=0, minimum=-24, maximum=24, rate=44100, pulse=False):
        with tempfile.TemporaryDirectory(dir=ROOT / "artifacts") as tmp:
            folder = Path(tmp)
            source, baseline = folder / "source.wav", folder / "baseline.wav"
            state = 53123
            noise = []
            for n in range(12347):
                state = (1664525 * state + 1013904223) & 0xffffffff
                noise.append(.08 * (state / 0xffffffff * 2 - 1) if not pulse else (.35 if n % 1901 == 17 else 0))
            write_float_wav(source, [noise, [-.37 * x for x in reversed(noise)]], rate)
            config = folder / "session.json"
            config.write_text(json.dumps({"schema_version": 1, "source_sha256": sha256(source), "parameters": {"outputDb": current}}))
            manifest = json.loads(subprocess.run([str(CLI), "render", "--source", str(source), "--out", str(baseline), "--session", str(config)], capture_output=True, text=True, check=True, timeout=30).stdout)
            snapshot = {"session_id": "generalization", "session_revision": 7, "source_sha256": sha256(source), "base_graph_sha256": manifest["graph_sha256"], "source_handle": "generalization_source", "selection_samples": [0, len(noise)], "sample_rate": rate,
                        "parameters": [{"stage_id": "output", "parameter_id": "outputDb", "unit": "dB", "value": current, "min": minimum, "max": maximum}]}
            if prompt == "at-current-rms":
                value = measure_audio(baseline)["rms_dbfs"]
                prompt = f"Bring RMS to {value:.7f} dBFS."
                objective = {"kind": "target", "value_db": value}
            fixture = {"schema_version": 1, "arm": "rules", "request": {"schema_version": 1, "request_id": "generalization_request", "session_id": snapshot["session_id"], "prompt": prompt}, "snapshot": snapshot,
                       "asset": {"snapshot": snapshot, "source_path": str(source), "baseline_path": str(baseline), "parameters": {"outputDb": current}}}
            (folder / "bridge-input.json").write_text(json.dumps(fixture))
            env = {**os.environ, "TONESCOPE_ENABLE_LIVE": "0"}
            result = subprocess.run(["node", "--experimental-strip-types", str(ROOT / "evals/level_bridge.mjs"), str(RUNTIME.resolve()), str(CLI.resolve()), str(folder.resolve())], capture_output=True, text=True, check=True, timeout=45, env=env)
            bridge = json.loads(result.stdout)
            response = bridge["response"]
            self.assertIsNotNone(response, bridge)
            self.assertEqual(response["status"], status, response)
            self.assertEqual(response["usage"]["cost_usd"], 0)
            task = {"expected_status": status, "authorized_output_db": {"value": current, "min": minimum, "max": maximum}, "objective": objective,
                    "tolerances": {"level_db": .25, "peak_db": .05, "waveform_max_abs": 1e-6}}
            patch = response["proposal"]["parameter_patch"] if response["proposal"] else None
            grade = grade_audio(task, baseline, bridge["preview_path"], status=response["status"], patch=patch)
            self.assertTrue(grade["task_success"], grade)
            if status != "ready":
                self.assertEqual(response["usage"]["candidate_frames"], 0)
                self.assertIsNone(bridge["preview_path"])

    def test_decimal_relative_gain_and_nonzero_control(self):
        self.check_case("Please turn the volume down by 2.75 decibels.", {"kind": "delta", "value_db": -2.75}, current=4)
        self.check_case("Adjust output gain by +1.25 dB.", {"kind": "delta", "value_db": 1.25}, current=-3, rate=96000)

    def test_numeric_and_word_rms_targets(self):
        self.check_case("Bring RMS to -22.5 dBFS.", {"kind": "target", "value_db": -22.5}, current=-4)
        self.check_case("Normalize to minus twenty-seven dBFS.", {"kind": "target", "value_db": -27}, current=2, rate=48000)

    def test_peak_maximum_with_pulses(self):
        self.check_case("Maximize volume without sample peak exceeding -2.75 dBFS.", {"kind": "maximize", "peak_ceiling_dbfs": -2.75}, pulse=True, current=-2)

    def test_infeasible_target_and_authorization_abstain(self):
        self.check_case("Bring RMS to -12 dBFS while keeping sample peak below -2 dBFS.", {"kind": "none"}, "abstain", pulse=True)
        self.check_case("Raise the volume by 4.5 dB.", {"kind": "none"}, "abstain", current=2, maximum=3)

    def test_explicit_and_measured_noops(self):
        self.check_case("Keep the output as is.", {"kind": "delta", "value_db": 0}, "noop")
        self.check_case("at-current-rms", {}, "noop", current=3)


if __name__ == "__main__":
    unittest.main()
