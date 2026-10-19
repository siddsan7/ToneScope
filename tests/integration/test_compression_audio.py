"""Independent fixed-graph compression outcomes from actual WAV bytes."""
import copy
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "evals"))
from compression_audio import grade_compression, measure_passages
from oracles import write_float_wav


class CompressionAudioTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.samples = [[(0.1 if n < 64 else 0.5) * math.sin((n + c * 3) * math.pi / 8)
                         * (1 if c == 0 else 0.65) for n in range(128)] for c in range(2)]
        self.baseline = self.wav("baseline.wav", self.samples)
        self.task = {"expected_status": "ready", "passages": {"origin": "manual", "soft": [0, 64], "hard": [64, 128]},
                     "authorized_threshold_db": {"value": 0, "min": -60, "max": 0},
                     "objective": {"reduction_db": 3, "soft_max_change_db": 0.5, "peak_ceiling_dbfs": -1},
                     "tolerances": {"contrast_db": 0.5, "soft_db": 0.05, "peak_db": 0.05}}

    def wav(self, name, samples, rate=48000):
        path = self.root / name
        write_float_wav(path, samples, rate)
        return path

    def patch(self, value=-18):
        return [{"stage_id": "compressor", "parameter_id": "thresholdDb", "unit": "dBFS", "value": value}]

    def render(self, hard_db=-3, soft_db=0):
        return self.wav("candidate.wav", [[x * 10 ** ((soft_db if n < 64 else hard_db) / 20)
                                          for n, x in enumerate(channel)] for channel in self.samples])

    def grade(self, path=None, **kwargs):
        return grade_compression(self.task, self.baseline, path, **kwargs)

    def test_manual_coordinates_are_absolute_and_metrics_are_independent(self):
        passages = {"origin": "manual", "soft": [100, 164], "hard": [164, 228]}
        measured = measure_passages(self.baseline, passages, selection_start=100)
        self.assertEqual((measured["frames"], measured["channels"], measured["sample_rate"]), (128, 2, 48000))
        self.assertEqual(measured["soft"]["interval"], [100, 164])
        self.assertEqual(measured["hard"]["relative_interval"], [64, 128])
        self.assertAlmostEqual(measured["contrast_db"], 20 * math.log10(5), places=5)
        self.assertAlmostEqual(measured["hard"]["peak"], 0.5)
        self.assertEqual(len(measured["audio_sha256"]), 64)
        self.task.update(passages=passages, selection_start=100)
        self.assertTrue(self.grade(self.render(), status="ready", patch=self.patch())["task_success"])

    def test_success_and_generalization_use_outcomes_not_golden_threshold(self):
        for threshold, reduction in ((-15, 2.8), (-21, 3.2)):
            result = self.grade(self.render(-reduction), status="ready", patch=self.patch(threshold))
            self.assertTrue(result["task_success"], result)
            self.assertAlmostEqual(result["observed_reduction_db"], reduction, places=5)

    def test_forged_report_metrics_and_uniform_gain_do_not_pass(self):
        self.task["reported_metrics"] = {"contrast_reduction_db": 3, "soft_change_db": 0}
        for path in (self.baseline, self.render(-3, -3)):
            result = self.grade(path, status="ready", patch=self.patch())
            self.assertFalse(result["task_success"])
            self.assertIn("contrast_objective_missed", result["errors"])

    def test_partial_outcomes_fail(self):
        result = self.grade(self.render(-4, -1), status="ready", patch=self.patch())
        self.assertAlmostEqual(result["observed_reduction_db"], 3, places=5)
        self.assertIn("soft_passage_level_changed", result["errors"])
        self.assertFalse(result["task_success"])
        result = self.grade(self.render(-1), status="ready", patch=self.patch())
        self.assertIn("contrast_objective_missed", result["errors"])
        self.task["objective"]["peak_ceiling_dbfs"] = -12
        result = self.grade(self.render(), status="ready", patch=self.patch())
        self.assertIn("sample_peak_ceiling_exceeded", result["errors"])

    def test_silent_and_missing_passages_never_pass_ready(self):
        self.task["passages"] = None
        result = self.grade(self.render(), status="ready", patch=self.patch())
        self.assertFalse(result["task_success"])
        self.assertIn("missing_or_silent_passages", result["errors"])
        self.task["expected_status"] = "abstain"
        self.assertTrue(self.grade(status="abstain")["task_success"])
        self.task["passages"] = {"origin": "manual", "soft": [0, 64], "hard": [64, 128]}
        for value in (0, 1e-10):
            self.samples = [[value] * 128 for _ in range(2)]
            self.baseline = self.wav("silent.wav", self.samples)
            result = self.grade(self.baseline, status="ready", patch=self.patch())
            self.assertIsNone(result["baseline"]["contrast_db"])
            self.assertFalse(result["task_success"])
            if value == 0:
                self.assertIsNone(result["baseline"]["soft"]["rms_dbfs"])

    def test_correct_abstention_handles_silent_and_nonpositive_contrast(self):
        self.task["expected_status"] = "abstain"
        for soft, hard in ((0, 0.2), (0.1, 0), (0.2, 0.1), (0.1, 0.1)):
            samples = [[soft] * 64 + [hard] * 64 for _ in range(2)]
            self.baseline = self.wav("boundary.wav", samples)
            result = self.grade(status="abstain")
            self.assertTrue(result["task_success"], result)
            self.assertFalse(result["critical"])

    def test_outcomes_generalize_across_signal_shapes_and_levels(self):
        for soft, hard, phase in ((0.02, 0.2, 1), (0.04, 0.4, 5)):
            self.samples = [[(soft if n < 64 else hard) * math.sin((n + c * phase) * math.pi / 8)
                             * (1 if c == 0 else 0.6) for n in range(128)] for c in range(2)]
            self.baseline = self.wav("generalized.wav", self.samples)
            result = self.grade(self.render(), status="ready", patch=self.patch(-22))
            self.assertTrue(result["task_success"], result)

    def test_invalid_intervals_fail_closed(self):
        variants = [None, {}, {"origin": "automatic", "soft": [0, 64], "hard": [64, 128]}]
        for span in ([0, 1], [-1, 64], [0, 129], [True, 64], [0., 64], [0, 64, 80], "0,64"):
            variants.append({"origin": "manual", "soft": span, "hard": [64, 128]})
        variants += [{"origin": "manual", "soft": [0, 65], "hard": [64, 128]}]
        for passages in variants[1:]:
            with self.subTest(passages=passages), self.assertRaises(ValueError):
                measure_passages(self.baseline, passages)
        for start in (-1, True, 0.5):
            with self.assertRaises(ValueError):
                measure_passages(self.baseline, self.task["passages"], start)

    def test_noop_abstain_and_failed_decisions(self):
        for status in ("noop", "abstain", "failed", "timed_out", "canceled", "invented"):
            self.assertFalse(self.grade(status=status)["task_success"], status)
        self.task["expected_status"] = "noop"
        self.assertFalse(self.grade(status="noop")["task_success"])
        self.task["objective"]["reduction_db"] = 0
        self.assertTrue(self.grade(status="noop")["task_success"])
        self.assertFalse(self.grade(self.baseline, status="noop")["task_success"])
        self.assertFalse(self.grade(status="noop", patch=self.patch())["task_success"])
        self.task["expected_status"] = "abstain"
        self.assertTrue(self.grade(status="abstain")["task_success"])
        self.assertFalse(self.grade(self.baseline, status="abstain")["task_success"])
        self.assertFalse(self.grade(status="abstain", patch=self.patch())["task_success"])

    def test_patch_authorization_is_strict(self):
        invalid = [None, [], {}, self.patch(True), self.patch(float("nan")), self.patch(float("inf")),
                   self.patch("-18"), self.patch(-61), self.patch(1), self.patch() * 2]
        for key, value in (("stage_id", "output"), ("parameter_id", "ratio"), ("unit", "dB"), ("extra", 1)):
            patch = self.patch()
            patch[0][key] = value
            invalid.append(patch)
        for patch in invalid:
            result = self.grade(self.render(), status="ready", patch=patch)
            self.assertTrue(result["critical"], result)
            self.assertFalse(result["task_success"])

    def test_audio_shape_and_decode_failures_are_critical(self):
        candidates = [self.wav("mono.wav", self.samples[:1]), self.wav("short.wav", [c[:-1] for c in self.samples]),
                      self.wav("rate.wav", self.samples, 44100), self.wav("empty.wav", [[], []]),
                      self.wav("nan.wav", [[float("nan")]]), self.wav("inf.wav", [[float("inf")]])]
        malformed = self.root / "malformed.wav"
        body = b"WAVEfmt " + struct.pack("<I", 1) + b"\0\0data" + struct.pack("<I", 0)
        malformed.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)
        candidates.append(malformed)
        for path in candidates:
            result = self.grade(path, status="ready", patch=self.patch())
            self.assertTrue(result["critical"], result)
            self.assertFalse(result["task_success"])
        self.baseline = malformed
        self.assertTrue(self.grade(status="abstain")["critical"])

    def test_waveform_guards_reject_wrong_channel_polarity_delay_and_amplification(self):
        variants = {"polarity": [[-x for x in c] for c in self.samples],
                    "swap": self.samples[::-1],
                    "delay": [[0] + c[:-1] for c in self.samples],
                    "amplify": [[x * 1.1 for x in c] for c in self.samples],
                    "unlinked": [[x * (0.9 if ch == 0 else 0.8) for x in c]
                                 for ch, c in enumerate(self.samples)]}
        for name, samples in variants.items():
            result = self.grade(self.wav(name + ".wav", samples), status="ready", patch=self.patch())
            self.assertTrue(result["critical"], (name, result))
            self.assertIn("not_linked_nonnegative_attenuation", result["errors"])

    def test_zero_input_cannot_produce_output(self):
        self.samples[0][0] = self.samples[1][0] = 0
        self.baseline = self.wav("zeros.wav", self.samples)
        candidate = copy.deepcopy(self.samples)
        candidate[0][0] = 0.01
        result = self.grade(self.wav("nonzero.wav", candidate), status="ready", patch=self.patch())
        self.assertTrue(result["critical"])

    def test_ready_requires_actual_render(self):
        result = self.grade(status="ready", patch=self.patch())
        self.assertTrue(result["critical"])
        self.assertIn("missing_candidate_audio", result["errors"])


if __name__ == "__main__":
    unittest.main()
