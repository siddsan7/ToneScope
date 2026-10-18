import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("public_acquisition", ROOT / "scripts/acquire-public-corpus.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Response(io.BytesIO):
    def __init__(self, data, length):
        super().__init__(data)
        self.headers = {"Content-Length": str(length)}


class PublicAcquisitionTests(unittest.TestCase):
    def test_bounded_integrity_publication_and_preservation(self):
        payload = b"fixture-only"
        manifest = {"download_url": "https://zenodo.org/api/records/14963133/files/P3_music.zip/content", "archive": {
            "bytes": len(payload), "md5": hashlib.md5(payload).hexdigest(), "sha256": hashlib.sha256(payload).hexdigest()}}
        fixtures = ROOT / "artifacts/test-tmp"
        fixtures.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=fixtures) as folder:
            root = Path(folder)
            output = root / "valid.zip"
            with patch.object(module.urllib.request, "urlopen", return_value=Response(payload, len(payload))) as request:
                self.assertEqual(module.acquire(output, manifest), "downloaded_verified")
                self.assertEqual(module.acquire(output, manifest), "verified_cache")
                self.assertEqual(request.call_count, 1)
            self.assertEqual(output.read_bytes(), payload)
            self.assertFalse(output.with_name(output.name + ".partial").exists())
            for name, data, length in (("oversize", payload+b"x", len(payload)), ("short", payload[:-1], len(payload)),
                                       ("header", payload, len(payload)+1), ("corrupt", b"x"*len(payload), len(payload))):
                with self.subTest(name=name), patch.object(module.urllib.request, "urlopen", return_value=Response(data, length)):
                    target = root / (name+".zip")
                    with self.assertRaises(ValueError): module.acquire(target, manifest)
                    self.assertFalse(target.exists())
                    self.assertLessEqual(target.with_name(target.name+".partial").stat().st_size, len(payload))
            with patch.object(module.urllib.request, "urlopen", return_value=Response(payload, len(payload))):
                with self.assertRaises(TimeoutError): module.acquire(root/"timeout.zip", manifest, seconds=1, now=iter([0, 2]).__next__)
            output.write_bytes(b"owned existing data")
            with self.assertRaises(ValueError): module.acquire(output, manifest)
            self.assertEqual(output.read_bytes(), b"owned existing data")
