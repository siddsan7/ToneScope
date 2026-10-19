"""Guard the audible comparison and local showcase provenance surfaces."""
import importlib.util
import math
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import wave

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("showcase", ROOT / "scripts/build-showcase.py")
showcase = importlib.util.module_from_spec(spec)
spec.loader.exec_module(showcase)


class ShowcaseTests(unittest.TestCase):
    def test_existing_output_is_never_replaced(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temporary:
            folder = Path(temporary)
            marker = folder / "existing.txt"
            marker.write_text("keep")
            with self.assertRaises(FileExistsError):
                showcase.build(SimpleNamespace(output=folder, cli=folder / "absent-cli", archive=folder / "absent-archive"))
            self.assertEqual(marker.read_text(), "keep")

    def test_match_preserves_stereo_and_shared_headroom(self):
        original = [[.9, -.9, .3], [.45, -.45, .15]]
        processed = [[x * 4 for x in channel] for channel in original]
        dry, wet, gains = showcase.matched_audition(original, processed)
        self.assertAlmostEqual(gains["wet_rms_match_db"], -12.041199826559248)
        self.assertAlmostEqual(showcase.rms(showcase.flatten(dry)), showcase.rms(showcase.flatten(wet)))
        self.assertLessEqual(max(map(abs, showcase.flatten(wet))), .95)
        self.assertEqual(dry, original)
        self.assertEqual(wet, dry)

    def test_matching_cannot_clip_an_impulsive_candidate(self):
        original = [[.5] * 100]
        processed = [[5.] + [0.] * 99]
        dry, wet, gains = showcase.matched_audition(original, processed)
        self.assertLess(gains["shared_headroom_db"], 0)
        self.assertAlmostEqual(max(wet[0]), .95)
        self.assertAlmostEqual(showcase.rms(dry[0]), showcase.rms(wet[0]))

    def test_silence_and_channel_shape_fail_explicitly(self):
        for dry, wet in (([[0.]], [[1.]]), ([[1.]], [[0.]]), ([[1.]], [[1.], [1.]])):
            with self.assertRaises(ValueError):
                showcase.matched_audition(dry, wet)

    def test_audition_pcm_is_browser_compatible_and_plot_escapes_text(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temporary:
            path = Path(temporary)
            showcase.pcm16(path / "clip.wav", [[.5, -.5], [.25, -.25]], 48000)
            with wave.open(str(path / "clip.wav")) as stream:
                self.assertEqual((stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getnframes()), (2, 2, 48000, 2))
            showcase.plot(path / "plot.svg", "Measured <gain>", [("a & b", [(0, -3), (1, 0)])], "seconds", "dB")
            svg = (path / "plot.svg").read_text()
            self.assertIn("Measured &lt;gain&gt;", svg)
            self.assertIn("a &amp; b", svg)
            with self.assertRaises(ValueError):
                showcase.plot(path / "bad.svg", "bad", [("bad", [(0, math.nan)])], "x", "y")


if __name__ == "__main__":
    unittest.main()
