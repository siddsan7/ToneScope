#!/usr/bin/env python3
"""Offline independent evaluation. Exit 0 pass, 1 failure, 2 blocked/configuration."""
import argparse
import datetime
import html
import json
import math
import platform
import subprocess
import sys
import uuid
from pathlib import Path
from provenance import runtime_files, source_identity

from oracles import (VERSION, compressor_gain_db, fixture, flatten, read_wav,
                     residual, rms, sha256, write_float_wav)

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def git_commit():
    proc = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True)
    return proc.stdout.strip() if proc.returncode == 0 else None


def git_dirty():
    proc = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain"], capture_output=True, text=True)
    return bool(proc.stdout.strip()) if proc.returncode == 0 else None


def close(actual, expected, tolerance, label):
    if not math.isfinite(actual) or abs(actual - expected) > tolerance:
        raise AssertionError(f"{label}: {actual!r}, expected {expected!r} +/- {tolerance}")


class Runner:
    def __init__(self, args):
        self.args = args
        self.out = Path(args.output).resolve()
        self.out.mkdir(parents=True, exist_ok=True)
        self.run_id = "run-" + uuid.uuid4().hex
        self.commit = git_commit()
        self.results = []
        self.cli = str(Path(args.cli).resolve()) if args.cli else None
        self.initial_source = source_identity(ROOT)
        self.initial_dirty = git_dirty()
        self.runtime = runtime_files(ROOT, self.cli)
        self.command_index = 0
        self.active_folder = self.out

    def command(self, *args, reject=False):
        if not self.cli or not Path(self.cli).is_file():
            raise FileNotFoundError("native --cli executable is required")
        argv = [self.cli, *map(str, args)]
        self.command_index += 1
        record_path = self.active_folder / f"command-{self.command_index:04d}.json"
        try:
            proc = subprocess.run(argv, capture_output=True, text=True, timeout=30)
        except subprocess.TimeoutExpired as exc:
            write_json(record_path, {"argv": argv, "status": "timed_out", "stdout": str(exc.stdout or ""), "stderr": str(exc.stderr or "")})
            raise
        write_json(record_path, {"argv": argv, "returncode": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr})
        if reject:
            if proc.returncode == 0:
                raise AssertionError("invalid input was accepted")
            try:
                error = json.loads(proc.stderr or proc.stdout)
            except (ValueError, TypeError) as exc:
                raise AssertionError("rejection did not return structured JSON") from exc
            if not isinstance(error, dict) or not error.get("error"):
                raise AssertionError("rejection lacked an error field")
            return {"rejected": True}
        if proc.returncode:
            raise AssertionError(f"CLI exited {proc.returncode}: {proc.stderr[:1000]}")
        return json.loads(proc.stdout)

    def case(self, case_id, families, requirements, fn=None, reason=None):
        folder = self.out / case_id
        folder.mkdir(exist_ok=True)
        self.active_folder = folder
        result = {"schema_version": 1, "run_id": self.run_id, "case_id": case_id,
                  "suite": self.args.suite, "families": families, "requirement_ids": requirements,
                  "commit_sha": self.commit, "oracle_version": VERSION,
                  "status": "blocked", "measurements": {}, "reason": reason,
                  "fixture_sha256": None, "artifact_sha256": None, "evidence_paths": []}
        if fn:
            try:
                result["measurements"] = fn(folder)
                result["status"], result["reason"] = "pass", None
            except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
                result["reason"] = str(exc)
            except Exception as exc:
                result["status"], result["reason"] = "fail", f"{type(exc).__name__}: {exc}"
        artifacts = sorted(p for p in folder.rglob("*") if p.is_file() and p.name != "result.json")
        result["evidence_paths"] = [{"path": str(p.relative_to(self.out)), "sha256": sha256(p)} for p in artifacts]
        source = folder / "input.wav"
        output = folder / "output.wav"
        if not source.exists():
            source = next(iter(sorted(folder.glob("*-input.wav"))), source)
        if not output.exists():
            output = next((p for p in sorted(folder.glob("*.wav")) if p != source and not p.name.endswith("-input.wav")), output)
        result["fixture_sha256"] = sha256(source) if source.exists() else None
        result["artifact_sha256"] = sha256(output) if output.exists() else None
        result["fixture_path"] = str(source.relative_to(self.out)) if source.exists() else None
        result["artifact_path"] = str(output.relative_to(self.out)) if output.exists() else None
        write_json(folder / "result.json", result)
        self.results.append(result)

    def render(self, folder, samples, parameters=None, block=257, output="output.wav", rate=48000):
        source = folder / ("input.wav" if output == "output.wav" else Path(output).stem + "-input.wav")
        write_float_wav(source, samples, rate)
        session = folder / "session.json"
        write_json(session, {"schema_version": 1, "parameters": parameters or {}})
        target = folder / output
        manifest = self.command("render", "--source", source, "--out", target,
                                "--session", session, "--block-size", block, "--overwrite")
        write_json(folder / (target.stem + "-manifest.json"), manifest)
        if manifest.get("source_sha256") != sha256(source) or manifest.get("artifact_sha256") != sha256(target):
            raise AssertionError("render provenance hashes do not match actual files")
        return read_wav(target)[1]

    def identity(self, folder, kind):
        original = fixture(kind)
        actual = self.render(folder, original)
        expected = read_wav(folder / "input.wav")[1]
        if len(actual) != len(expected) or len(actual[0]) != len(expected[0]):
            raise AssertionError("identity changed channels or frames")
        metrics = residual(flatten(actual), flatten(expected))
        close(metrics["max_abs"], 0, 1e-6, "identity max absolute error")
        close(metrics["rms"], 0, 1e-5, "identity null RMS (-100 dBFS)")
        return metrics

    def block(self, folder):
        samples = fixture("multitone", frames=16001)
        params = {"compressor": True, "equalizer": True, "drive": True}
        reference = self.render(folder, samples, params, block=1, output="reference.wav")
        metrics = {}
        for block in (31, 128, 257, 1024):
            actual = self.render(folder, samples, params, block=block, output=f"block-{block}.wav")
            metrics[str(block)] = residual(flatten(reference), flatten(actual))
            close(metrics[str(block)]["max_abs"], 0, 1e-5, "block invariance")
        return metrics

    def deterministic(self, folder):
        samples = fixture("noise")
        self.render(folder, samples, output="output.wav")
        self.render(folder, samples, output="repeat.wav")
        if sha256(folder / "output.wav") != sha256(folder / "repeat.wav"):
            raise AssertionError("reset render is not byte deterministic")
        return {"byte_identical": True}

    def gain(self, folder):
        samples = fixture("multitone")
        actual = self.render(folder, samples, {"inputDb": -6, "outputDb": 3})
        original = read_wav(folder / "input.wav")[1]
        expected = [x * 10 ** (-3 / 20) for x in flatten(original)]
        metrics = residual(flatten(actual), expected)
        close(metrics["max_abs"], 0, 1e-6, "dB gain")
        return metrics

    def compressor(self, folder):
        # DC isolates static amplitude response after 2.5 s settling. No timing claim.
        metrics = {}
        for level in (-30, -18, -6):
            amplitude = 10 ** (level / 20)
            samples = [[amplitude] * 144000]
            actual = self.render(folder, samples, {"compressor": True, "thresholdDb": -18,
                                 "ratio": 4, "kneeDb": 0, "attackMs": 1, "releaseMs": 10},
                                 output=f"level{level}.wav")
            source_level = rms(read_wav(folder / f"level{level}-input.wav")[1][0][-24000:])
            measured = 20 * math.log10(rms(actual[0][-24000:]) / source_level)
            expected = compressor_gain_db(20 * math.log10(source_level), -18, 4)
            close(measured, expected, .25, "compressor steady curve dB")
            metrics[str(level)] = {"measured_gain_db": measured, "expected_gain_db": expected}
        return metrics

    def inspect(self, folder, frames=8192):
        samples = fixture("noise", frames=frames)
        write_float_wav(folder / "input.wav", samples)
        reference = flatten(read_wav(folder / "input.wav")[1])
        info = self.command("inspect", "--source", folder / "input.wav")
        write_json(folder / "inspect.json", info)
        if (info["frames"], info["channels"], info["sample_rate_hz"]) != (frames, 2, 48000):
            raise AssertionError("decode dimensions mismatch")
        close(20 * math.log10(info["rms"] / rms(reference)), 0, .1, "RMS meter dB")
        close(20 * math.log10(info["peak"] / max(map(abs, reference))), 0, .1, "peak meter dB")
        return info

    def compare(self, folder, silence=False):
        dry = fixture("silence" if silence else "noise")
        wet = [[v * .5 for v in channel] for channel in dry]
        write_float_wav(folder / "input.wav", dry)
        write_float_wav(folder / "wet.wav", wet)
        result = self.command("compare", "--dry", folder / "input.wav", "--wet", folder / "wet.wav",
                              "--start", 100, "--end", 7000, "--match")
        write_json(folder / "comparison.json", result)
        if silence:
            if result["valid"]:
                raise AssertionError("silence must not claim a valid RMS match")
        else:
            if not result["valid"] or result["gainCapped"]:
                raise AssertionError("valid uncapped fixture did not match")
            selected = [v for frame in zip(*read_wav(folder / "input.wav")[1]) for v in frame]
            close(result["dryRms"], rms(selected[200:14000]), 1e-7, "selected region RMS")
            close(20 * math.log10(result["gain"] / 2), 0, .25, "match gain dB")
            close(result["residualRms"], 0, 1e-5, "matched residual")
        return result

    def malformed(self, folder, kind):
        target = folder / "input.wav"
        if kind == "truncated":
            write_float_wav(target, fixture("noise"))
            target.write_bytes(target.read_bytes()[:-11])
        elif kind == "huge":
            target.write_bytes(b"RIFF\xff\xff\xff\xffWAVEdata\xff\xff\xff\xff")
        elif kind == "nonfinite":
            write_float_wav(target, [[float("nan"), float("inf")]])
        else:
            target.write_bytes(b"not a wave file")
        return self.command("inspect", "--source", target, reject=True)

    def bad_session(self, folder, session):
        write_float_wav(folder / "input.wav", fixture("impulse"))
        write_json(folder / "invalid-session.json", session)
        return self.command("render", "--source", folder / "input.wav", "--out", folder / "output.wav",
                            "--session", folder / "invalid-session.json", reject=True)

    def no_clobber(self, folder, sidecar=False):
        write_float_wav(folder / "input.wav", fixture("impulse"))
        output = folder / "output.wav"
        protected = folder / "output.wav.json" if sidecar else output
        protected.write_bytes(b"existing asset must remain unchanged")
        before = sha256(protected)
        result = self.command("render", "--source", folder / "input.wav", "--out", output, reject=True)
        if sha256(protected) != before or (sidecar and output.exists()):
            raise AssertionError("render overwrote an asset or published audio after sidecar conflict")
        return result

    def mutation(self, folder):
        original = flatten(fixture("noise", frames=512))
        mutations = {"gain_factor": [x * 1.01 for x in original],
                     "one_sample_delay": [0] + original[:-1],
                     "channel_swap": [x for pair in zip(original[1::2], original[::2]) for x in pair]}
        detection = {name: residual(original, altered)["max_abs"] > 1e-6 for name, altered in mutations.items()}
        wrong_rms = math.sqrt(math.fsum(x * x for x in original))
        detection["rms_normalization"] = abs(20 * math.log10(wrong_rms / rms(original))) > .1
        if not all(detection.values()):
            raise AssertionError("critical numerical mutation survived")
        write_json(folder / "mutations.json", detection)
        return detection

    def execute(self):
        suite = self.args.suite
        if suite == "contracts":
            self.case("IO-DECODE-001", ["IO-DECODE", "ANA-METER"], ["TS-001", "TS-008"], self.inspect)
            self.case("IO-DECODE-ONE-FRAME", ["IO-DECODE", "ANA-METER"], ["TS-001", "TS-008"], lambda f: self.inspect(f, 1))
            for kind in ("corrupt", "truncated", "huge", "nonfinite"):
                self.case("IO-MALFORMED-" + kind, ["IO-MALFORMED"], ["TS-001"], lambda f, k=kind: self.malformed(f, k))
            for name, data in (("version", {"schema_version": 99, "parameters": {}}),
                               ("unknown", {"schema_version": 1, "parameters": {"unknown": 1}}),
                               ("ratio", {"schema_version": 1, "parameters": {"ratio": 0}})):
                self.case("STATE-REJECT-" + name, ["STATE-VALIDATION"], ["TS-011"], lambda f, d=data: self.bad_session(f, d))
        elif suite == "dsp":
            for kind in ("silence", "impulse", "noise", "multitone"):
                self.case("CMP-UNITY-" + kind, ["CMP-UNITY", "EXPORT-ROUNDTRIP"], ["TS-007", "TS-013"], lambda f, k=kind: self.identity(f, k))
            self.case("DSP-BLOCK-001", ["DSP-BLOCK"], ["TS-004"], self.block)
            self.case("DSP-GAIN-001", ["CMP-GAIN"], ["TS-007"], self.gain)
            self.case("DSP-COMP-STATIC-001", ["DSP-COMP"], ["TS-004"], self.compressor)
            self.case("DSP-QUALIFICATION-PENDING", ["DSP-EQ", "DSP-DRIVE", "DSP-XOVER"], ["TS-004", "TS-010"],
                      reason="Independent EQ, compressor timing, crossover and converged alias references are not implemented; no qualification claim.")
        elif suite == "integration":
            self.case("RENDER-RESET-001", ["EXPORT-ROUNDTRIP", "EXPORT-PROVENANCE"], ["TS-013"], self.deterministic)
            self.case("CMP-MATCH-001", ["CMP-MATCH", "CMP-GAIN"], ["TS-005", "TS-007"], self.compare)
            self.case("CMP-SILENCE-001", ["CMP-SILENCE"], ["TS-005"], lambda f: self.compare(f, True))
            self.case("EVAL-MUTATION-001", ["EVAL-MUTATION"], ["TS-016"], self.mutation)
            self.case("EXPORT-NOCLOBBER-AUDIO", ["EXPORT-NOCLOBBER"], ["TS-013"], self.no_clobber)
            self.case("EXPORT-NOCLOBBER-MANIFEST", ["EXPORT-NOCLOBBER"], ["TS-013"], lambda f: self.no_clobber(f, True))
        elif suite == "ai-replay":
            from ai import replay
            self.case("AI-PROTOCOL-BASELINES", ["AI-CONTRACT"], ["TS-015"], lambda f: replay(f, self.args.split))
            self.case("AI-LIVE-QUALIFICATION-PENDING", ["AI-TASK", "AI-ATTACK", "AI-APPLY"], ["TS-015"],
                      reason="Deterministic protocol fixtures cannot qualify live models, product tool authorization or human preference; approved live runs and final holdout unavailable.")
        else:
            self.case("AI-QUALIFICATION-PENDING", ["AI-CONTRACT", "AI-TASK", "AI-ATTACK", "AI-APPLY"], ["TS-015"],
                      reason="AI implementation, approved corpus, credentials/budget and locked split evidence are unavailable; no mock pass.")
        status = "fail" if any(r["status"] == "fail" for r in self.results) else "blocked" if any(r["status"] == "blocked" for r in self.results) else "pass"
        coverage = json.loads((ROOT / "evals/coverage.json").read_text())["requirements"]
        passed = {f for r in self.results if r["status"] == "pass" for f in r["families"]}
        summary = {"schema_version": 1, "run_id": self.run_id, "suite": suite, "status": status,
                   "split": self.args.split,
                   "commit_sha": self.commit, "working_tree_dirty": git_dirty(),
                   "source_identity_sha256": self.initial_source,
                   "source_unchanged": self.initial_source == source_identity(ROOT),
                   "started_working_tree_dirty": self.initial_dirty,
                   "runtime_files": self.runtime,
                   "runtime_unchanged": self.runtime == runtime_files(ROOT, self.cli),
                   "gates_sha256": sha256(ROOT / "evals/gates.json"),
                   "runner_sha256": sha256(__file__), "oracle_sha256": sha256(ROOT / "evals/oracles.py"),
                   "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   "platform": platform.platform(), "python": sys.version.split()[0],
                   "cli_sha256": sha256(self.cli) if self.cli and Path(self.cli).is_file() else None,
                   "oracle_version": VERSION, "results": self.results,
                   "coverage": {req: {"required_families": fs, "missing_passing_families": sorted(set(fs) - passed)} for req, fs in coverage.items()}}
        write_json(self.out / "run.json", summary)
        print(json.dumps({"run_id": self.run_id, "status": status, "cases": len(self.results), "output": str(self.out)}))
        return {"pass": 0, "fail": 1, "blocked": 2}[status]


def report(runs, out):
    summaries = []
    for path in sorted(Path(runs).rglob("run.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        summaries.append(f"<h2>{html.escape(data['suite'])}: {html.escape(data['status'])}</h2><p>{html.escape(data['run_id'])}</p>" +
                         "<ul>" + "".join(f"<li>{html.escape(c['case_id'])}: {html.escape(c['status'])} {html.escape(c.get('reason') or '')}</li>" for c in data["results"]) + "</ul>")
    if not summaries:
        raise ValueError("no run.json evidence found")
    Path(out).write_text("<!doctype html><meta charset='utf-8'><title>ToneScope evaluation evidence</title><h1>Evaluation evidence</h1>" + "".join(summaries), encoding="utf-8")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("eval", "report", "release-check"), default="eval")
    parser.add_argument("--suite", choices=("contracts", "dsp", "integration", "ai-replay", "ai-live"))
    parser.add_argument("--output")
    parser.add_argument("--cli")
    parser.add_argument("--split", choices=("development", "validation", "locked-test"), default="development")
    parser.add_argument("--runs")
    parser.add_argument("--out")
    parser.add_argument("--manifest")
    args = parser.parse_args()
    try:
        if args.command == "report":
            return report(args.runs, args.out)
        if args.command == "release-check":
            from release_check import validate_manifest
            errors = validate_manifest(Path(args.manifest))
            print(json.dumps({"schema_version": 1, "status": "fail" if errors else "pass", "errors": errors}, indent=2))
            return 1 if errors else 0
        if not args.suite or not args.output:
            parser.error("eval requires --suite and --output")
        return Runner(args).execute()
    except (ValueError, OSError, TypeError) as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
