#!/usr/bin/env python3
"""Offline public DI regression: --archive P3_music.zip --cli EXE --output NEW_DIR.

No downloader, playback, hardware or provider calls. Public files are inspected
regression evidence, never an unseen holdout or a perceptual qualification.
"""
import argparse
import datetime
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import traceback
import zipfile
from oracles import read_wav, write_float_wav, flatten, residual, sha256

MANIFEST = Path(__file__).with_name("datasets") / "guitar-techs-public.json"


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False)+"\n", encoding="utf-8")


def verify_archive(path, expected):
    if path.stat().st_size != expected["bytes"] or path.stat().st_size > 200_000_000:
        raise ValueError("archive size differs from frozen inventory or exceeds 200 MB")
    md5, sha = hashlib.md5(), hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024*1024):
            md5.update(chunk)
            sha.update(chunk)
    if md5.hexdigest() != expected["md5"] or sha.hexdigest() != expected["sha256"]:
        raise ValueError("archive published MD5/frozen SHA-256 mismatch")


def safe_listing(archive, maximum):
    entries, seen = [], set()
    for info in archive.infolist():
        path = PurePosixPath(info.filename)
        mode = info.external_attr >> 16
        if (not info.filename or path.is_absolute() or "\\" in info.filename
            or ":" in info.filename or ".." in path.parts
            or info.filename in seen or stat.S_ISLNK(mode)
            or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
            raise ValueError("unsafe/duplicate ZIP member: " + info.filename)
        seen.add(info.filename)
        entries.append({"member":info.filename,"bytes":info.file_size,
                        "compressed_bytes":info.compress_size,"crc32":f"{info.CRC:08x}"})
    if sum(x["bytes"] for x in entries) > min(maximum, 1024**3):
        raise ValueError("ZIP exceeds 1 GiB uncompressed cap")
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    out, archive_path, cli = args.output.resolve(), args.archive.resolve(), args.cli.resolve()
    # A new dedicated directory prevents clobbering source assets and old runs.
    try:
        out.mkdir(parents=True, exist_ok=False)
    except OSError as error:
        print(json.dumps({"status":"blocked","reason":"output must be a new directory: "+str(error)}))
        return 2
    summary = {"schema_version":1,"status":"blocked","classification":"PUBLIC INSPECTABLE REGRESSION; NOT AN UNSEEN HOLDOUT",
               "holdout_qualified":False,"hardware_or_model_or_perceptual_claim":False,"records":[],
               "generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "runner_sha256":sha256(__file__),"oracle_sha256":sha256(Path(__file__).with_name("oracles.py")),
               "manifest_sha256":sha256(MANIFEST)}

    def command(folder, label, *arguments):
        argv = [str(cli), *map(str, arguments)]
        record = {"argv":argv}
        try:
            process = subprocess.run(argv, capture_output=True, text=True, timeout=120)
            record.update(exit_code=process.returncode,stdout=process.stdout,stderr=process.stderr)
        except subprocess.TimeoutExpired as error:
            record.update(exit_code=None,status="timed_out",stdout=str(error.stdout or ""),stderr=str(error.stderr or ""))
            write_json(folder/(label+"-command.json"), record)
            raise
        write_json(folder/(label+"-command.json"), record)
        if process.returncode:
            raise RuntimeError(f"{label} failed with exit {process.returncode}; see raw command record")
        return json.loads(process.stdout)

    try:
        frozen = json.loads(MANIFEST.read_text(encoding="utf-8"))
        if len(frozen["records"]) != 2 or frozen["holdout_qualified"] is not False:
            raise ValueError("unexpected frozen corpus inventory")
        verify_archive(archive_path, frozen["archive"])
        summary.update(corpus=frozen,archive_sha256=sha256(archive_path),cli_path=str(cli),cli_sha256=sha256(cli))
        summary["compiled_build_info"] = command(out,"build-info","build-info")
        with zipfile.ZipFile(archive_path) as archive:
            write_json(out/"archive-listing.json",safe_listing(archive,frozen["maximum_uncompressed_bytes"]))
            # Only the two explicitly frozen regular files may be flattened.
            for index, item in enumerate(frozen["records"],1):
                folder = out/f"clip-{index:02}"
                folder.mkdir()
                result = {**item,"status":"fail","transform":frozen["transform"]}
                try:
                    info = archive.getinfo(item["member"])
                    if (info.is_dir() or info.file_size != item["bytes"]
                        or f"{info.CRC:08x}" != item["crc32"]):
                        raise ValueError("frozen member metadata mismatch")
                    data = archive.read(info)  # zipfile validates the member CRC.
                    if hashlib.sha256(data).hexdigest() != item["sha256"]:
                        raise ValueError("frozen member SHA-256 mismatch before decoding")
                    original = folder/"original-DI.wav"
                    original.write_bytes(data)
                    rate,samples = read_wav(original)
                    frames = item["frames"]
                    if (rate != item["sample_rate_hz"] or len(samples) != item["channels"]
                        or any(len(channel) != frames for channel in samples) or frames > rate*30):
                        raise ValueError("decoded dimensions differ from frozen full-clip inventory")
                    source = folder/"input.wav"
                    write_float_wav(source,samples,rate)
                    inspected = command(folder,"inspect","inspect","--source",source)
                    if (inspected["frames"],inspected["channels"],inspected["sample_rate_hz"]) != (frames,len(samples),rate):
                        raise AssertionError("native inspect dimensions differ from independent decoder")
                    bypass = folder/"bypass.wav"
                    bypass_manifest = command(folder,"bypass-render","render","--source",source,"--out",bypass)
                    comparison = command(folder,"bypass-compare","compare","--dry",source,"--wet",bypass,"--start",0,"--end",frames)
                    wet_rate,wet = read_wav(bypass)
                    if wet_rate != rate or len(wet) != len(samples) or any(len(c)!=frames for c in wet):
                        raise ValueError("bypass dimensions changed")
                    metrics = residual(flatten(read_wav(source)[1]),flatten(wet))
                    if not comparison["valid"] or comparison["residualRms"] != 0 or metrics["max_abs"] != 0 or metrics["rms"] != 0:
                        raise AssertionError("independent exact bypass null failed")
                    config = folder/"enabled-session.json"
                    write_json(config,{"schema_version":1,"parameters":frozen["enabled_parameters"]})
                    enabled = folder/"enabled.wav"
                    enabled_manifest = command(folder,"enabled-render","render","--source",source,"--out",enabled,"--session",config)
                    if enabled_manifest["oversampling"] != 4 or enabled_manifest["latency_samples"] != 32:
                        raise AssertionError("native manifest did not confirm enabled 4x drive")
                    finite = command(folder,"enabled-inspect","inspect","--source",enabled)
                    enabled_rate,actual = read_wav(enabled)
                    if enabled_rate != rate or len(actual)!=len(samples) or any(len(c)!=frames or any(not math.isfinite(v) for v in c) for c in actual):
                        raise AssertionError("enabled 4x/compressor finite shape failed")
                    for path,manifest in ((bypass,bypass_manifest),(enabled,enabled_manifest)):
                        if manifest["source_sha256"]!=sha256(source) or manifest["artifact_sha256"]!=sha256(path):
                            raise AssertionError("native render provenance mismatch")
                    result.update(status="pass",source_sha256=sha256(source),inspect=inspected,
                                  bypass_comparison=comparison,identity_metrics=metrics,enabled_inspect=finite,
                                  enabled_manifest=enabled_manifest,enabled_sha256=sha256(enabled))
                except Exception as error:
                    result.update(reason=str(error),traceback=traceback.format_exc())
                write_json(folder/"result.json",result)
                summary["records"].append(result)
        summary["cli_unchanged"] = sha256(cli)==summary["cli_sha256"]
        summary["status"] = "pass" if summary["cli_unchanged"] and len(summary["records"])==2 and all(r["status"]=="pass" for r in summary["records"]) else "fail"
    except Exception as error:
        summary.update(reason=str(error),traceback=traceback.format_exc())
    summary["functional_count"] = sum(r["status"]=="pass" for r in summary["records"])
    summary["evidence"] = [{"path":str(p.relative_to(out)),"sha256":sha256(p)} for p in sorted(out.rglob("*")) if p.is_file()]
    write_json(out/"run.json",summary)
    print(json.dumps({"status":summary["status"],"functional_count":summary["functional_count"],"output":str(out)}))
    return {"pass":0,"fail":1,"blocked":2}[summary["status"]]


if __name__ == "__main__":sys.exit(main())
