"""The renderer and evaluator must bind pending source files without staging."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load("build_identity", ROOT / "scripts/build-identity.py")
provenance = load("provenance", ROOT / "evals/provenance.py")


class SourceIdentityTests(unittest.TestCase):
    def test_pending_sources_ignored_artifacts_and_deleted_files(self):
        temporary = ROOT / "artifacts/test-tmp"
        temporary.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary) as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / ".gitignore").write_text("artifacts/\n", encoding="utf-8")
            tracked = root / "tracked.cpp"
            tracked.write_text("initial", encoding="utf-8")
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)

            def identity():
                value = build.identity(root)
                self.assertEqual(value, provenance.source_identity(root))
                return value

            original = identity()
            pending = root / "new source é.cpp"
            pending.write_text("first", encoding="utf-8")
            added = identity()
            self.assertNotEqual(original, added)
            pending.write_text("second", encoding="utf-8")
            edited = identity()
            self.assertNotEqual(added, edited)
            (root / "artifacts").mkdir()
            (root / "artifacts/report.json").write_text("evidence", encoding="utf-8")
            self.assertEqual(edited, identity())
            tracked.unlink()
            self.assertNotEqual(edited, identity())
            self.assertEqual("??", subprocess.check_output(
                ["git", "-C", str(root), "status", "--porcelain", "--", pending.name],
                encoding="utf-8").split()[0])
