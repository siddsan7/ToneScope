"""Independently measured actual native/service flow, enabled by trusted paths."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"evals"))
from oracles import read_wav, rms, sha256, write_float_wav

RUNTIME=Path(os.environ.get("TONESCOPE_ASSISTANT_RUNTIME",str(ROOT/"services/audio-assistant")))
CLI=Path(os.environ.get("TONESCOPE_TEST_CLI",str(ROOT/"build/windows-dev/tonescope_cli_artefacts/Release/tonescope_cli.exe")))
if os.environ.get("TONESCOPE_REQUIRE_NATIVE_TESTS") == "1" and not (CLI.is_file() and (RUNTIME/"agent/lib/service.ts").is_file() and (RUNTIME/"node_modules/zod/package.json").is_file()):
    raise RuntimeError("Required native assistant integration dependencies are missing; CI must not skip them")


@unittest.skipUnless(CLI.is_file() and (RUNTIME/"agent/lib/service.ts").is_file(),"built CLI and installed assistant runtime required")
class NativeAssistantEvaluation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT/"artifacts").mkdir(exist_ok=True)

    def run_probe(self,folder,scenario,amplitude=.05):
        frames,rate=48000,48000
        source=folder/"source.wav"
        write_float_wav(source,[[amplitude*math.sin(2*math.pi*440*n/rate) for n in range(frames)]],rate)
        baseline=folder/"baseline.wav"
        manifest=json.loads(subprocess.run([str(CLI),"render","--source",str(source),"--out",str(baseline)],capture_output=True,text=True,check=True,timeout=30).stdout)
        snapshot={"session_id":"independent_session","session_revision":3,"source_sha256":sha256(source),"base_graph_sha256":manifest["graph_sha256"],"source_handle":"host_owned",
                  "selection_samples":[0,frames],"sample_rate":rate,"parameters":[{"stage_id":"output","parameter_id":"outputDb","unit":"dB","value":0,"min":-24,"max":24}]}
        asset={"snapshot":snapshot,"source_path":str(source),"baseline_path":str(baseline),"parameters":{"outputDb":0}}
        (folder/"probe.json").write_text(json.dumps({"snapshot":snapshot,"asset":asset}))
        result=subprocess.run(["node",str(Path(__file__).with_name("assistant_native_probe.mjs")),str(RUNTIME.resolve()),str(CLI.resolve()),str(folder.resolve()),scenario],capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stderr)
        output=json.loads(result.stdout)
        return output,source

    def test_actual_rms_intervention_and_artifact_identity(self):
        with tempfile.TemporaryDirectory(dir=ROOT/"artifacts") as tmp:
            folder=Path(tmp)
            output,source=self.run_probe(folder,"level")
            self.assertEqual(output["status"],"ready",output)
            preview=Path((folder/"preview-path.txt").read_text())
            self.assertEqual(sha256(preview),output["preview"]["audio_sha256"])
            before=rms(read_wav(source)[1][0]);after=rms(read_wav(preview)[1][0])
            self.assertAlmostEqual(20*math.log10(after/before),6,places=4)
            measured=next(m["value"] for m in output["preview"]["measurements"] if m["measurement_id"]=="preview_rms_dbfs")
            self.assertAlmostEqual(measured,20*math.log10(after),places=6)
            self.assertTrue(output["proposal"]["requires_user_acceptance"])
            self.assertEqual(output["usage"]["candidate_frames"],48000)

    def test_actual_service_rejects_forgeries_and_automatic_apply(self):
        for scenario in ("forged-measurement","automatic-apply","stale-revision","fabricated-prose"):
            with self.subTest(scenario=scenario),tempfile.TemporaryDirectory(dir=ROOT/"artifacts") as tmp:
                output,_=self.run_probe(Path(tmp),scenario)
                self.assertEqual(output["status"],"failed",output)
                self.assertIsNone(output["proposal"])
                self.assertIsNone(output["preview"])

    def test_silence_abstains_without_candidate(self):
        with tempfile.TemporaryDirectory(dir=ROOT/"artifacts") as tmp:
            output,_=self.run_probe(Path(tmp),"silence",amplitude=0)
            self.assertEqual(output["status"],"abstain",output)
            self.assertIsNone(output["preview"])
            self.assertIsNone(output["proposal"])
            self.assertEqual(output["usage"]["candidate_frames"],0)


if __name__=="__main__":unittest.main()
