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
import traceback
from pathlib import Path
from provenance import runtime_files, source_identity
from numeric import eq_response, tone_transfer, compressor_reference, crossover_response, drive_periodic_reference

from oracles import (VERSION, compressor_gain_db, fixture, flatten, read_wav,
                     residual, rms, sha256, write_float_wav)

ROOT = Path(__file__).resolve().parents[1]
GATES = json.loads((ROOT / "evals/gates.json").read_text())


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
                write_json(folder / "failure.json", {"exception_type":type(exc).__name__, "message":str(exc), "traceback":traceback.format_exc()})
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
        close(metrics["max_abs"], 0, GATES["identity_max_abs"], "identity max absolute error")
        close(metrics["rms"], 0, GATES["identity_residual_rms"], "identity null RMS (-100 dBFS)")
        return metrics

    def block(self, folder):
        samples = fixture("multitone", frames=16001)
        params = {"compressor": True, "equalizer": True, "drive": True}
        reference = self.render(folder, samples, params, block=1, output="reference.wav")
        metrics = {}
        for block in (31, 128, 257, 1024):
            actual = self.render(folder, samples, params, block=block, output=f"block-{block}.wav")
            metrics[str(block)] = residual(flatten(reference), flatten(actual))
            close(metrics[str(block)]["max_abs"], 0, GATES["block_max_abs"], "block invariance")
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

    def eq(self, folder):
        metrics = {}
        for rate in (44100, 48000, 96000):
            for bin_index in (3, 17, 93, 557, 1100):
                count = 4096
                frequency = bin_index * rate / count
                warmup = rate // 2
                samples = [[.1 * math.sin(2*math.pi*frequency*n/rate) for n in range(warmup+count)]]
                params = {"equalizer": True, "lowDb": 6, "midDb": -9, "highDb": 3,
                          "midHz": 1300, "midQ": 1.3}
                target = f"eq-{rate}-{bin_index}.wav"
                actual = self.render(folder, samples, params, output=target, rate=rate)
                source = read_wav(folder / (Path(target).stem + "-input.wav"))[1]
                measured = tone_transfer(source[0][-count:], actual[0][-count:], frequency, rate)
                expected = eq_response(frequency, rate, 6, -9, 3, 1300, 1.3)
                error_db = 20*math.log10(abs(measured / expected))
                close(error_db, 0, GATES["eq_db"], "independent EQ transfer dB")
                close(abs(measured - expected), 0, GATES["eq_complex_relative"]*abs(expected), "complex EQ transfer")
                metrics[f"{rate}/{bin_index}"] = {"frequency_hz": frequency, "error_db": error_db,
                    "complex_abs_error": abs(measured-expected), "phase_error_radians": __import__("cmath").phase(measured/expected)}
        write_json(folder / "metrics.json", metrics)
        return metrics

    def compressor_timing(self, folder):
        metrics = {}
        for rate in (44100,48000,96000):
            # Long settled low/high/low plateaus isolate both detector and reduction timing.
            width = rate // 2
            samples = [[.02]*width + [.5]*width + [.02]*width]
            params = {"compressor":True, "thresholdDb":-18, "ratio":4, "kneeDb":6,
                      "attackMs":10, "releaseMs":150}
            target = f"timing-{rate}.wav"
            actual = self.render(folder, samples, params, output=target, rate=rate)
            source = read_wav(folder / (Path(target).stem + "-input.wav"))[1][0]
            expected = compressor_reference(source, rate)
            errors = [abs(20*math.log10(y/e)) for y,e in zip(actual[0], expected)]
            close(max(errors),0,GATES["compressor_db"],"compressor time-domain dB curve")
            transitions = {}
            for name, start, end in (("attack",width,2*width),("release",2*width,3*width)):
                gain = [20*math.log10(y/x) for y,x in zip(actual[0][start:end],source[start:end])]
                oracle = [20*math.log10(y/x) for y,x in zip(expected[start:end],source[start:end])]
                target_gain = oracle[0] + (oracle[-1]-oracle[0])*(1-math.exp(-1))
                direction = 1 if oracle[-1]>oracle[0] else -1
                measured_cross = next(i for i,v in enumerate(gain) if direction*(v-target_gain)>=0)
                expected_cross = next(i for i,v in enumerate(oracle) if direction*(v-target_gain)>=0)
                close(measured_cross,expected_cross,max(GATES["compressor_timing_samples"],GATES["compressor_timing_relative"]*expected_cross),"compressor timing samples")
                transitions[name] = {"measured_samples":measured_cross,"reference_samples":expected_cross}
            metrics[str(rate)] = {"max_curve_error_db":max(errors), "transitions":transitions}
        write_json(folder / "metrics.json", metrics)
        return metrics

    def channels_and_domain(self, folder):
        metrics = {}
        for rate in (8000,44100,48000,96000,192000):
            # All declared finite ingress amplitudes clamp at +/-16 independently by channel.
            samples = [[0.,.125,-.5,1.,-1.,16.,-16.,100.,-100.], [1.,0.,0.,0.,0.,0.,0.,0.,0.]]
            params = {"toneHz":min(5000,.4*rate)}
            actual = self.render(folder,samples,params,rate=rate,output=f"domain-{rate}.wav",block=1)
            expected = [[max(-16.,min(16.,x)) for x in c] for c in samples]
            errors = residual(flatten(actual),flatten(expected))
            close(errors["max_abs"],0,GATES["identity_max_abs"],"channel domain/clamp")
            metrics[str(rate)] = errors
        return metrics

    def crossover(self, folder):
        metrics = {}
        for rate in (44100,48000,96000):
            for bin_index in (3,17,93,557,1100):
                count, warmup = 4096, rate//2
                frequency = bin_index*rate/count
                samples = [[.1*math.sin(2*math.pi*frequency*n/rate) for n in range(warmup+count)]]
                actual = self.render(folder,samples,{"compressor":True,"multiband":True,"ratio":1},rate=rate,output=f"xover-{rate}-{bin_index}.wav")
                source = read_wav(folder / f"xover-{rate}-{bin_index}-input.wav")[1]
                measured = tone_transfer(source[0][-count:],actual[0][-count:],frequency,rate)
                expected = crossover_response(frequency,rate)
                close(20*math.log10(abs(measured)),0,GATES["crossover_db"],"crossover magnitude")
                close(abs(measured-expected),0,GATES["crossover_complex_absolute"],"crossover complex phase reference")
                metrics[f"{rate}/{bin_index}"] = {"magnitude_db":20*math.log10(abs(measured)),"complex_error":abs(measured-expected),
                    "phase_radians":__import__("cmath").phase(measured),"raw_identity_complex_error":abs(measured-1)}
        write_json(folder/"metrics.json",metrics)
        return metrics

    def alias(self, folder):
        metrics, failures = {}, []
        count = 8192
        for rate in (44100,48000,96000):
            for bin_index in (683,1093,1531):
                frequency = bin_index*rate/count
                warmup = count*3
                samples = [[.5*math.sin(2*math.pi*frequency*n/rate) for n in range(warmup+count+64)]]
                ref2048, harmonics = drive_periodic_reference(frequency,rate,count,factor=2048)
                ref4096, _ = drive_periodic_reference(frequency,rate,count,factor=4096)
                convergence = residual(ref2048,ref4096)["rms"]
                close(convergence,0,GATES["alias_reference_convergence_rms"],"high-rate reference convergence")
                errors = {}
                for factor in (1,2,4):
                    target = f"alias-{rate}-{bin_index}-{factor}.wav"
                    actual = self.render(folder,samples,{"drive":True,"driveDb":30,"toneHz":5000,"oversampling":factor},rate=rate,output=target)
                    manifest = json.loads((folder/(Path(target).stem+"-manifest.json")).read_text())
                    delay = manifest["latency_samples"]
                    expected_delay = 0 if factor==1 else 32
                    close(delay,expected_delay,0,"declared oversampling pure delay")
                    aligned = actual[0][warmup+delay:warmup+delay+count]
                    # Fit one complex gain/delay using only the fundamental; this does
                    # not erase higher-harmonic errors or count intentional harmonics as aliases.
                    ratio = tone_transfer(ref4096,aligned,frequency,rate)
                    phase = __import__("cmath").phase(ratio)
                    # Pure-delay fitting is evaluated at each intended harmonic.
                    calibrated, _ = drive_periodic_reference(frequency,rate,count,factor=4096,phase_offset=phase)
                    calibrated = [x*abs(ratio) for x in calibrated]
                    # Root-mean-square waveform error includes finite resampler/tone
                    # discrepancies. No subtraction of measured distortion is allowed.
                    errors[str(factor)] = {"rms_error":residual(aligned,calibrated)["rms"],
                        "fundamental_gain":abs(ratio),"fundamental_phase_radians":phase,"latency_samples":delay}
                improvement = 20*math.log10(errors["1"]["rms_error"]/errors["4"]["rms_error"])
                metrics[f"{rate}/{bin_index}"] = {"sample_rate_hz":rate,"frequency_hz":frequency,"reference_convergence_rms":convergence,
                    "intended_harmonics":harmonics,"modes":errors,"improvement_db":improvement}
                if improvement < GATES["alias_improvement_db"]:
                    failures.append({"frequency_hz":frequency,"improvement_db":improvement})
        write_json(folder/"metrics.json",metrics)
        write_json(folder/"failures.json",failures)
        if failures:
            raise AssertionError(f"frozen alias improvement gate failed: {failures}")
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

    def delay_alignment(self, folder):
        samples = fixture("noise",frames=8192)
        write_float_wav(folder/"input.wav",samples)
        metrics = {}
        for delay in (0,1,32):
            wet = [[0.]*delay + channel[:-delay] if delay else list(channel) for channel in samples]
            path = folder/f"wet-{delay}.wav"
            write_float_wav(path,wet)
            result = self.command("compare","--dry",folder/"input.wav","--wet",path,"--start",100,"--end",8000,"--latency-samples",delay)
            write_json(folder/f"aligned-{delay}.json",result)
            if not result["valid"]:
                raise AssertionError("eligible declared-delay comparison rejected")
            close(result["residualRms"],0,GATES["identity_residual_rms"],"declared-delay null")
            if delay:
                wrong = self.command("compare","--dry",folder/"input.wav","--wet",path,"--start",100,"--end",8000,"--latency-samples",delay-1)
                if wrong["residualRms"] < .01:
                    raise AssertionError("one-sample misalignment was hidden")
            metrics[str(delay)] = result
        return metrics

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

    def parameter_boundaries(self, folder):
        # Frozen scalar limits from the public contract; do not derive expected
        # acceptance by asking the implementation's validator.
        limits = {"inputDb":(-24,24),"thresholdDb":(-60,0),"ratio":(1,20),"attackMs":(.1,100),
                  "releaseMs":(10,2000),"kneeDb":(0,24),"makeupDb":(-24,24),"lowDb":(-18,18),
                  "midDb":(-18,18),"highDb":(-18,18),"midHz":(20,20000),"midQ":(.2,10),
                  "driveDb":(0,36),"toneHz":(20,20000),"outputDb":(-24,24)}
        write_float_wav(folder/"input.wav",fixture("impulse",frames=33))
        metrics = {}
        for key,(lo,hi) in limits.items():
            for label,value,reject in (("minimum",lo,False),("maximum",hi,False),("below",lo-1,True),("above",hi+1,True),("coercion",str(lo),True)):
                session = folder/f"{key}-{label}.json"
                write_json(session,{"schema_version":1,"parameters":{key:value}})
                result = self.command("render","--source",folder/"input.wav","--out",folder/f"{key}-{label}.wav","--session",session,"--overwrite",reject=reject)
                metrics[f"{key}/{label}"] = {"rejected":bool(result.get("rejected",False))}
        return metrics

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
            self.case("STATE-PARAMETER-BOUNDARIES", ["STATE-VALIDATION"], ["TS-011"], self.parameter_boundaries)
        elif suite == "dsp":
            for kind in ("silence", "impulse", "noise", "multitone"):
                self.case("CMP-UNITY-" + kind, ["CMP-UNITY", "EXPORT-ROUNDTRIP"], ["TS-007", "TS-013"], lambda f, k=kind: self.identity(f, k))
            self.case("DSP-BLOCK-001", ["DSP-BLOCK"], ["TS-004"], self.block)
            self.case("DSP-GAIN-001", ["CMP-GAIN"], ["TS-007"], self.gain)
            self.case("DSP-COMP-STATIC-001", ["DSP-COMP"], ["TS-004"], self.compressor)
            self.case("DSP-EQ-TRANSFER-001", ["DSP-EQ"], ["TS-004"], self.eq)
            self.case("DSP-COMP-TIMING-001", ["DSP-COMP"], ["TS-004"], self.compressor_timing)
            self.case("DSP-DOMAIN-CHANNEL-001", ["CMP-PHASE", "IO-LIMIT"], ["TS-001", "TS-007"], self.channels_and_domain)
            self.case("DSP-XOVER-COMPLEX-001", ["DSP-XOVER"], ["TS-010"], self.crossover)
            self.case("DSP-ALIAS-CONVERGENCE-001", ["DSP-DRIVE", "GRAPH-LATENCY"], ["TS-004", "TS-010"], self.alias)
        elif suite == "integration":
            self.case("RENDER-RESET-001", ["EXPORT-ROUNDTRIP", "EXPORT-PROVENANCE"], ["TS-013"], self.deterministic)
            self.case("CMP-MATCH-001", ["CMP-MATCH", "CMP-GAIN"], ["TS-005", "TS-007"], self.compare)
            self.case("CMP-SILENCE-001", ["CMP-SILENCE"], ["TS-005"], lambda f: self.compare(f, True))
            self.case("CMP-DELAY-DECLARED-001", ["CMP-DELAY", "CMP-PHASE"], ["TS-005", "TS-007"], self.delay_alignment)
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
