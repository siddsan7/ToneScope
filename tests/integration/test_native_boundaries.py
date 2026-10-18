"""Regression checks for reviewed native boundaries; requires a built CLI."""
import hashlib
import json
import os
import shutil
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CLI = Path(os.environ.get('TONESCOPE_TEST_CLI',str(ROOT / 'build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe')))


@unittest.skipUnless(CLI.is_file(), 'native CLI must be built first')
class NativeBoundaryTests(unittest.TestCase):
    def setUp(self):
        parent = ROOT / 'artifacts/test-tmp'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.assertTrue(Path(self.temp.name).resolve().is_relative_to(parent.resolve()))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.wav'
        payload = struct.pack('<f', .125) * 2048
        self.source.write_bytes(b'RIFF' + struct.pack('<I', len(payload)+36) + b'WAVEfmt ' +
                               struct.pack('<IHHIIHH', 16, 3, 1, 48000, 192000, 4, 32) +
                               b'data' + struct.pack('<I', len(payload)) + payload)

    def call(self, *args):
        result = subprocess.run([str(CLI), *map(str, args)], capture_output=True,
                                encoding='utf-8', timeout=20)
        return result.returncode, json.loads(result.stdout)

    def render(self, session):
        path = self.root / 'session.json'
        path.write_text(json.dumps(session), encoding='utf-8')
        return self.call('render', '--source', self.source, '--out', self.root/'out.wav', '--session', path)

    def test_windows_unicode_arguments_and_streams(self):
        for name in ('caf\u00e9.wav', 'guitar-\U0001f3b8.wav'):
            target = self.root / name
            target.write_bytes(self.source.read_bytes())
            code, value = self.call('inspect', '--source', target)
            self.assertEqual(code, 0, value)
            self.assertAlmostEqual(value['rms'], .125)
            self.assertEqual(value['frames'], 2048)

    def test_deep_unicode_output_and_sidecar_publication(self):
        folder = self.root
        for index in range(6):
            folder = folder / (str(index) + "-" + "nested-session-" * 3)
        def extended(path):
            return Path('\\\\?\\' + str(path.resolve())) if os.name == 'nt' else path
        def cleanup_deep_fixture():
            target = self.root.resolve()
            if not target.is_relative_to((ROOT / 'artifacts/test-tmp').resolve()):
                raise RuntimeError('Refusing cleanup outside native test fixture root')
            if extended(target).exists():
                shutil.rmtree(extended(target))
        self.addCleanup(cleanup_deep_fixture)
        extended(folder).mkdir(parents=True)
        target = folder / 'guitar-\U0001f3b8.wav'
        self.assertGreater(len(str(target)), 300)
        code, result = self.call('render', '--source', self.source, '--out', target, '--start', 100, '--end', 1900)
        self.assertEqual(code, 0, result)
        self.assertEqual(result['artifact_sha256'], hashlib.sha256(extended(target).read_bytes()).hexdigest())
        self.assertEqual(json.loads(extended(Path(str(target)+'.json')).read_text())['frames'], 1800)
        code, result = self.call('inspect', '--source', target)
        self.assertEqual(code, 0, result)
        self.assertEqual(result['frames'], 1800)
        code, result = self.call('compare', '--dry', target, '--wet', target)
        self.assertEqual(code, 0, result)
        self.assertEqual(result['residualRms'], 0)

    def test_shared_ui_loader_rejects_coercion_and_unknown_fields(self):
        for ui in ({'rms_match': 'false'}, {'selection_start': '0'}, {'unknown': True}, None):
            code, value = self.render({'schema_version': 1, 'parameters': {}, 'ui': ui})
            self.assertEqual(code, 2, value)
            self.assertIn('error', value)

    def test_empty_ui_defaults_are_valid(self):
        code, value = self.render({'schema_version': 1, 'parameters': {}, 'ui': {}})
        self.assertEqual(code, 0, value)

    def test_source_digest_is_enforced(self):
        session = {'schema_version': 1, 'parameters': {}, 'source_sha256': '0'*64}
        self.assertEqual(self.render(session)[0], 2)
        session['source_sha256'] = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.assertEqual(self.render(session)[0], 0)


if __name__ == '__main__':
    unittest.main()
