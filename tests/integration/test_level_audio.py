"""Real WAV tests of the independent level grader; no model or network calls."""
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "evals"))
from level_audio import grade_audio, measure_audio
from oracles import write_float_wav


class LevelAudioTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.samples = [[0.1 * math.sin(2 * math.pi * i / 32) for i in range(320)]]
        self.baseline = self.wav("baseline.wav", self.samples)
        self.task = {"expected_status": "ready", "objective": {"kind": "delta", "value_db": -3},
                     "authorized_output_db": {"value": 0, "min": -24, "max": 12},
                     "tolerances": {"level_db": 0.25, "peak_db": 0.05}}

    def wav(self, name, samples, rate=48000):
        path = self.root / name
        write_float_wav(path, samples, rate)
        return path

    def gain(self, db):
        return self.wav("candidate.wav", [[x * 10 ** (db / 20) for x in c] for c in self.samples])

    def patch(self, value=-3):
        return [{"stage_id": "output", "parameter_id": "outputDb", "unit": "dB", "value": value}]

    def grade(self, candidate=None, **kwargs):
        return grade_audio(self.task, self.baseline, candidate, **kwargs)

    def test_measurement_uses_all_channels_and_hashes_actual_file(self):
        path = self.wav("stereo.wav", [[0.5, -0.5], [0, 0]])
        result = measure_audio(path)
        self.assertEqual((result["sample_rate"], result["channels"], result["frames"]), (48000, 2, 2))
        self.assertAlmostEqual(result["rms"], math.sqrt(0.125))
        self.assertEqual(result["peak"], 0.5)
        self.assertEqual(len(result["audio_sha256"]), 64)
        self.assertNotEqual(result["audio_sha256"], measure_audio(self.baseline)["audio_sha256"])

    def test_forged_reported_metrics_cannot_replace_audio(self):
        self.task["preview"] = {"rms_delta_db": -3, "peak_dbfs": -99}
        self.task["reported_metrics"] = {"rms_delta_db": -3}
        result = self.grade(self.gain(0), status="ready", patch=self.patch(0))
        self.assertFalse(result["task_success"])
        self.assertTrue(result["decision_success"])
        self.assertFalse(result["audio_success"])
        self.assertIn("level_objective_missed", result["errors"])
        self.assertFalse(result["critical"])

    def test_correct_render_and_wrong_gain(self):
        result = self.grade(self.gain(-3), status="ready", patch=self.patch())
        self.assertTrue(result["task_success"], result)
        self.assertAlmostEqual(result["observed_delta_db"], -3, places=5)
        self.assertFalse(self.grade(self.gain(-2), status="ready", patch=self.patch())["task_success"])

    def test_realized_outcome_does_not_require_exact_optimal_patch(self):
        for actual_db in (-3.1, -2.9):
            result = self.grade(self.gain(actual_db), status="ready", patch=self.patch(actual_db))
            self.assertTrue(result["task_success"], result)

    def test_gain_patch_must_match_actual_transformation(self):
        result = self.grade(self.gain(-3), status="ready", patch=self.patch(0))
        self.assertFalse(result["task_success"])
        self.assertTrue(result["critical"])
        self.assertIn("output_gain_waveform_mismatch", result["errors"])
        self.task["authorized_output_db"]["value"] = 2
        result = self.grade(self.gain(-3), status="ready", patch=self.patch(-1))
        self.assertTrue(result["task_success"], result)

    def test_equal_rms_polarity_delay_and_channel_swap_fail(self):
        source = self.samples[0]
        self.samples = [source, [x * 0.5 for x in source]]
        self.baseline = self.wav("stereo-source.wav", self.samples)
        gain = 10 ** (-3 / 20)
        wrong = {"polarity": [[-x * gain for x in channel] for channel in self.samples],
                 "delay": [[x * gain for x in channel[1:] + channel[:1]] for channel in self.samples],
                 "channel-swap": [[x * gain for x in channel] for channel in reversed(self.samples)]}
        for name, samples in wrong.items():
            result = self.grade(self.wav(name + ".wav", samples), status="ready", patch=self.patch())
            self.assertAlmostEqual(result["observed_delta_db"], -3, places=5)
            self.assertFalse(result["task_success"], result)
            self.assertTrue(result["critical"])
            self.assertIn("output_gain_waveform_mismatch", result["errors"])

    def test_target_level_and_sample_peak_ceiling(self):
        before = measure_audio(self.baseline)
        self.task["objective"] = {"kind": "target", "value_db": before["rms_dbfs"] + 3,
                                  "peak_ceiling_dbfs": before["peak_dbfs"] + 2}
        result = self.grade(self.gain(3), status="ready", patch=self.patch(3))
        self.assertIn("sample_peak_ceiling_exceeded", result["errors"])
        self.task["objective"]["peak_ceiling_dbfs"] += 1
        self.assertTrue(self.grade(self.gain(3), status="ready", patch=self.patch(3))["task_success"])

    def test_tolerances_have_effect_on_measured_samples(self):
        self.assertTrue(self.grade(self.gain(-2.76), status="ready", patch=self.patch(-2.76))["task_success"])
        self.assertFalse(self.grade(self.gain(-2.74), status="ready", patch=self.patch(-2.74))["task_success"])
        peak = measure_audio(self.baseline)["peak_dbfs"]
        self.task["objective"]["peak_ceiling_dbfs"] = peak - 3
        self.assertTrue(self.grade(self.gain(-2.96), status="ready", patch=self.patch(-2.96))["task_success"])
        self.assertFalse(self.grade(self.gain(-2.94), status="ready", patch=self.patch(-2.94))["task_success"])

    def test_ready_cannot_pass_without_render(self):
        result = self.grade(status="ready", patch=self.patch())
        self.assertFalse(result["task_success"])
        self.assertTrue(result["critical"])
        self.assertIn("missing_candidate_audio", result["errors"])

    def test_high_crest_maximize_uses_sample_peak_not_rms(self):
        self.samples = [[0.001] * 1000]
        self.samples[0][0] = 0.5
        self.baseline = self.wav("crest.wav", self.samples)
        peak = measure_audio(self.baseline)["peak_dbfs"]
        self.task["objective"] = {"kind": "maximize", "peak_ceiling_dbfs": peak + 1}
        self.assertTrue(self.grade(self.gain(1), status="ready", patch=self.patch(1))["task_success"])
        self.assertFalse(self.grade(self.gain(0), status="ready", patch=self.patch(0))["task_success"])
        result = self.grade(self.gain(6), status="ready", patch=self.patch(6))
        self.assertIn("sample_peak_ceiling_exceeded", result["errors"])

    def test_maximize_respects_authorized_headroom(self):
        self.task["objective"] = {"kind": "maximize"}
        self.task["authorized_output_db"]["value"] = 11
        self.assertTrue(self.grade(self.gain(1), status="ready", patch=self.patch(12))["task_success"])
        self.assertFalse(self.grade(self.gain(0), status="ready", patch=self.patch(11))["task_success"])
        self.task["authorized_output_db"]["value"] = 12
        self.task["expected_status"] = "noop"
        self.assertTrue(self.grade(status="noop")["task_success"])

    def test_silence_has_no_invented_floor(self):
        self.baseline = self.wav("silence.wav", [[0] * 320])
        measured = measure_audio(self.baseline)
        self.assertIsNone(measured["rms_dbfs"])
        self.assertIsNone(measured["peak_dbfs"])
        result = self.grade(self.baseline, status="ready", patch=self.patch())
        self.assertIn("silence_has_no_finite_level", result["errors"])
        self.assertFalse(result["task_success"])
        self.task.update(expected_status="noop", objective={"kind": "none"})
        self.assertTrue(self.grade(status="noop")["task_success"])

    def test_invalid_audio_and_shape_are_critical(self):
        candidates = [self.wav("stereo.wav", self.samples * 2),
                      self.wav("short.wav", [self.samples[0][:-1]]),
                      self.wav("rate.wav", self.samples, 44100),
                      self.wav("empty.wav", [[]]),
                      self.wav("nan.wav", [[float("nan")]]),
                      self.wav("inf.wav", [[float("inf")]])]
        bad = self.root / "invalid.wav"
        bad.write_bytes(b"not wav")
        candidates.append(bad)
        truncated_format = self.root / "truncated-format.wav"
        body = b"WAVEfmt " + struct.pack("<I", 1) + b"\0\0data" + struct.pack("<I", 0)
        truncated_format.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)
        candidates.append(truncated_format)
        for path in candidates:
            with self.subTest(path=path):
                result = self.grade(path, status="ready", patch=self.patch())
                self.assertTrue(result["critical"], result)
                self.assertFalse(result["task_success"])
        with self.assertRaises(ValueError):
            measure_audio(candidates[3])

    def test_invalid_baseline_is_critical(self):
        empty = self.wav("empty.wav", [[]])
        result = grade_audio(self.task, empty, status="abstain")
        self.assertTrue(result["critical"])
        self.assertFalse(result["task_success"])

    def test_patch_authorization_is_strict_and_precedes_math(self):
        invalid = [None, [], {}, self.patch(True), self.patch(float("nan")),
                   self.patch(float("inf")), self.patch(-25), self.patch(13),
                   self.patch("-3"), self.patch() * 2]
        for key, value in (("stage_id", "drive"), ("parameter_id", "inputDb"), ("unit", "dBFS"), ("extra", 1)):
            patch = self.patch()
            patch[0][key] = value
            invalid.append(patch)
        for patch in invalid:
            with self.subTest(patch=patch):
                result = self.grade(self.gain(-3), status="ready", patch=patch)
                self.assertTrue(result["critical"], result)
                self.assertFalse(result["task_success"])

    def test_noop_abstention_and_failed_status_do_not_create_success(self):
        for status in ("noop", "abstain", "failed", "timed_out", "canceled", "invented"):
            result = self.grade(status=status)
            self.assertFalse(result["task_success"], status)
            self.assertFalse(result["decision_success"], status)
        self.task.update(expected_status="noop", objective={"kind": "delta", "value_db": 0})
        # A supplied candidate cannot make a no-op pass; the original audio is graded.
        self.task["objective"]["value_db"] = -3
        self.assertFalse(self.grade(self.gain(-3), status="noop")["task_success"])
        self.task["objective"]["value_db"] = 0
        self.assertTrue(self.grade(status="noop")["task_success"])
        self.assertFalse(self.grade(status="noop", patch=self.patch())["task_success"])
        self.task.update(expected_status="abstain", objective={"kind": "none"})
        self.assertTrue(self.grade(status="abstain")["task_success"])
        self.assertFalse(self.grade(status="abstain", patch=self.patch())["task_success"])


if __name__ == "__main__":
    unittest.main()
