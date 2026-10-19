"""Offline constrained compressor experiment using the production service/native DSP."""
import argparse
import datetime
import html
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

from compression_audio import grade_compression, measure_passages
from compression_tasks import ARMS, MODEL_ARMS, ROOT, canonical_hash, fixture_samples, load_corpus, strict_json
from level_eval import load_captures, summarize, write_json, record_baseline_failure
from oracles import sha256, write_float_wav
from provenance import compiled_identity, git, runtime_files, source_identity


def registry(task):
    p = task["parameters"]
    fields = [("input", "inputDb", "dB"), ("output", "outputDb", "dB"),
              ("compressor", "thresholdDb", "dBFS"), ("compressor", "ratio", "ratio"),
              ("compressor", "attackMs", "ms"), ("compressor", "releaseMs", "ms"),
              ("compressor", "kneeDb", "dB"), ("compressor", "makeupDb", "dB")]
    return [{"stage_id": stage, "parameter_id": name, "unit": unit,
             **(task["authorized_threshold_db"] if name == "thresholdDb" else {"value": p[name], "min": p[name], "max": p[name]})}
            for stage, name, unit in fields]


def run(args):
    corpus = load_corpus()
    captures = load_captures(args.captures, corpus)
    out, cli, runtime = Path(args.output).resolve(), Path(args.cli).resolve(), Path(args.runtime).resolve()
    if out.exists():
        raise ValueError("output already exists; evidence is never overwritten")
    node = shutil.which(args.node)
    if node is None or not cli.is_file() or not (runtime / "node_modules/zod/package.json").is_file():
        raise ValueError("built native CLI and installed Node/service runtime required")
    compiled, source = compiled_identity(cli), source_identity(ROOT)
    if not compiled or compiled.get("commit_sha") != git(ROOT, "rev-parse", "HEAD") or compiled.get("source_identity_sha256") != source:
        raise ValueError("renderer source identity is stale; rebuild the CLI")
    env = {k: v for k, v in os.environ.items() if k not in ("AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "NODE_OPTIONS", "NODE_PATH")}
    env["TONESCOPE_ENABLE_LIVE"] = "0"
    version = subprocess.check_output([node, "--version"], text=True, timeout=5, env=env).strip()
    if not version.startswith("v24."):
        raise ValueError("Node24 required by service lockfile")
    inventory = runtime_files(ROOT, cli)
    inventory += [{"path": str(p.resolve()), "sha256": sha256(p)} for p in
                  [ROOT / "evals/level_bridge.mjs", Path(node), runtime / "package-lock.json", *sorted((runtime / "agent/lib").glob("*.ts")),
                   *sorted(p for p in (runtime / "node_modules/zod").rglob("*") if p.is_file())]]
    out.mkdir(parents=True, exist_ok=False)
    (out / "sources").mkdir()
    (out / "cases").mkdir()
    if captures:
        write_json(out / "accepted-captures.json", {"schema_version": 1, "corpus_sha256": canonical_hash(corpus), "records": [
            {"task_id": k[0], "arm": k[1], "repeat": k[2], "capture": v} for k, v in sorted(captures.items())]})
    sources = {}
    for name, spec in corpus["fixtures"].items():
        path = out / "sources" / (name + ".wav")
        write_float_wav(path, fixture_samples(spec, corpus["frames"]), corpus["sample_rate"])
        if sha256(path) != spec["sha256"]:
            raise ValueError("frozen source bytes changed: " + name)
        sources[name] = path
    records, failures = [], []

    def command(argv, folder, label):
        start = time.monotonic()
        try:
            child = subprocess.run([str(x) for x in argv], capture_output=True, text=True, timeout=75, env=env)
            value = {"argv": [str(x) for x in argv], "exit_code": child.returncode, "stdout": child.stdout, "stderr": child.stderr,
                     "elapsed_ms": (time.monotonic() - start) * 1000, "timed_out": False}
        except subprocess.TimeoutExpired as exc:
            value = {"argv": [str(x) for x in argv], "exit_code": None, "stdout": str(exc.stdout or ""), "stderr": str(exc.stderr or ""),
                     "elapsed_ms": (time.monotonic() - start) * 1000, "timed_out": True}
        write_json(folder / (label + "-process.json"), value)
        if value["exit_code"] != 0 or len(value["stdout"].encode()) > 2 * 1024 * 1024:
            raise RuntimeError("child failure/timeout/oversized response: " + label)
        return strict_json(value["stdout"])

    for task in corpus["tasks"]:
        folder = out / "cases" / task["task_id"]
        folder.mkdir()
        source_path, baseline = sources[task["fixture_id"]], folder / "baseline.wav"
        write_json(folder / "baseline-session.json", {"schema_version": 1, "source_sha256": sha256(source_path), "parameters": task["parameters"]})
        try:
            manifest = command([cli, "render", "--source", source_path, "--out", baseline, "--session", folder / "baseline-session.json"], folder, "baseline")
            if manifest["artifact_sha256"] != sha256(baseline) or manifest["source_sha256"] != sha256(source_path):
                raise ValueError("baseline provenance mismatch")
            measured = measure_passages(baseline, task["passages"], task["selection_start"])
            if (measured["frames"], measured["channels"], measured["sample_rate"]) != (corpus["frames"], 2, corpus["sample_rate"]):
                raise ValueError("baseline audio shape mismatch")
        except (ValueError, RuntimeError, OSError, KeyError, TypeError) as exc:
            failures.append({"task_id": task["task_id"], "error": str(exc)})
            write_json(folder / "infrastructure-error.json", failures[-1])
            records.extend(record_baseline_failure(out, folder, task, corpus["model_repetitions"], captures, str(exc)))
            continue
        for arm in ARMS:
            for repeat in range(1 if arm in ("rules", "no-assistant") else corpus["model_repetitions"]):
                case = folder / (arm + "-" + str(repeat))
                case.mkdir()
                identifier = task["task_id"].replace("-", "_") + "_" + str(repeat)
                snapshot = {"session_id": "compression_" + identifier, "session_revision": 1, "source_sha256": sha256(source_path),
                            "base_graph_sha256": manifest["graph_sha256"], "source_handle": "asset_" + task["fixture_id"],
                            "selection_samples": [0, corpus["frames"]], "sample_rate": corpus["sample_rate"], "parameters": registry(task)}
                if task["passages"] is not None:
                    snapshot["passages"] = task["passages"]
                snapshot["processing"] = {k: task["parameters"][k] for k in ("compressor", "multiband", "equalizer", "drive")}
                request = {"schema_version": 1, "request_id": "request_" + identifier, "session_id": snapshot["session_id"], "prompt": task["prompt"]}
                context = {"request": request, "snapshot": snapshot, "untrusted_label": task["untrusted_label"],
                           "measurements": {"available": False, "reason": "grounding_disabled"} if arm == "grounding-disabled" else measured,
                           "note": "Independent baseline WAV measurements; manual labels are not inferred notes. Evaluator objectives/answers are not exported."}
                write_json(case / "request-context.json", context)
                record = {"task_id": task["task_id"], "parent_group": task["parent_group"], "source_group": task["source_group"], "category": task["category"],
                          "expected_status": task["expected_status"], "arm": arm, "repeat": repeat, "status": "completed", "grade": None,
                          "actual_model_calls": 0, "actual_model_cost_usd": 0, "request_context_sha256": canonical_hash(context), "historical_usage": None,
                          "record_path": str((case / "record.json").relative_to(out)).replace("\\", "/")}
                capture = captures.get((task["task_id"], arm, repeat))
                if arm in MODEL_ARMS and capture is None:
                    record.update(status="blocked", reason="paid_model_execution_disabled_no_capture", model_latency_ms=None)
                else:
                    try:
                        status, patch, candidate = "noop", None, None
                        if arm != "no-assistant":
                            fixture = {"schema_version": 1, "arm": arm, "request": request, "snapshot": snapshot,
                                       "asset": {"snapshot": snapshot, "source_path": str(source_path), "baseline_path": str(baseline), "parameters": task["parameters"]},
                                       "untrusted_label": task["untrusted_label"]}
                            if capture is not None:
                                fixture["capture"] = capture
                            write_json(case / "bridge-input.json", fixture)
                            bridge = command([node, "--experimental-strip-types", ROOT / "evals/level_bridge.mjs", runtime, cli, case], case, "bridge")
                            response = bridge.get("response")
                            record.update(mode_classification=bridge["mode_classification"], rejection_errors=bridge.get("rejection_errors", []),
                                          raw_actions=bridge["raw_actions"], historical_usage=bridge.get("historical_usage"), bridge_status=bridge["status"],
                                          evaluation_wrapper=bridge.get("evaluation_wrapper", False), proposal_origin=bridge.get("proposal_origin"),
                                          capture_classification=bridge.get("capture_classification"), usage=response["usage"] if response else None)
                            if capture is not None:
                                record["capture_provenance"] = capture["provenance"]
                            status = response["status"] if response else "failed"
                            patch = response["proposal"]["parameter_patch"] if response and response.get("proposal") else None
                            candidate = bridge.get("preview_path")
                            if candidate is not None:
                                candidate = Path(candidate).resolve()
                                if not candidate.is_relative_to(case / "previews") or sha256(candidate) != response["preview"]["audio_sha256"]:
                                    raise ValueError("candidate path/hash binding failed")
                        record["response_status"] = status
                        record["grade"] = grade_compression(task, baseline, candidate, status=status, patch=patch)
                    except (ValueError, RuntimeError, OSError, KeyError, TypeError) as exc:
                        record.update(status="failed", infrastructure_error=str(exc))
                        failures.append({"task_id": task["task_id"], "arm": arm, "repeat": repeat, "error": str(exc)})
                write_json(case / "record.json", record)
                records.append(record)
    unchanged = source == source_identity(ROOT) and all(Path(p["path"]).is_file() and sha256(p["path"]) == p["sha256"] for p in inventory)
    summary = {"schema_version": 1, "kind": "native-compression-development-experiment", "status": "completed" if unchanged and not failures else "failed",
               "classification": corpus["classification"], "holdout_qualified": False, "release_qualified": False, "live_qualification": "blocked",
               "paid_execution_enabled": False, "actual_model_calls": 0, "actual_model_cost_usd": 0, "corpus_sha256": canonical_hash(corpus),
               "corpus_tasks": len(corpus["tasks"]), "source_groups": len(corpus["fixtures"]), "records": len(records), "model_repetitions": 3,
               "created_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "compiled_identity": compiled, "source_identity_sha256": source,
               "source_and_runtime_unchanged": unchanged, "working_tree_dirty": bool(git(ROOT, "status", "--porcelain")), "runtime_files": inventory,
               "infrastructure_errors": failures, "statistics": summarize(records), "node_version": version, "python_version": sys.version.split()[0],
               "platform": platform.platform(), "limitations": ["Synthetic inspectable manual passages, not a holdout or independent musical performances.",
                   "Threshold-only full-band, neutral gain/hard-knee, initially uncompressed baseline; no attack or musical preference claim.",
                   "Imported captures are unauthenticated; replay time and historical usage are not current model latency/spend.",
                   "Linked attenuation waveform checks do not prove the Faust algorithm; native graph and binary identities bind the actual render."], "evidence": []}
    rows = ''.join('<tr>' + ''.join('<td>' + html.escape(str(x)) + '</td>' for x in (r["task_id"], r["arm"], r["repeat"],
                   "blocked" if r["status"] == "blocked" else "success" if (r.get("grade") or {}).get("task_success") else "miss/failure")) +
                   '<td><a href="' + html.escape(r["record_path"]) + '">record</a></td></tr>' for r in records)
    (out / "report.html").write_text('<!doctype html><meta charset="utf-8"><title>ToneScope compression experiment</title><style>body{font:16px/1.5 system-ui;max-width:1100px;margin:30px auto}td{padding:4px 12px}pre{white-space:pre-wrap}</style>'
        '<h1>Constrained compression experiment</h1><p>Actual native WAVs, manual soft/hard intervals, independent contrast/soft-level/peak grades. Paid execution disabled. Inspectable development data; no live model, perceptual or holdout qualification.</p>'
        '<p><a href="summary.json">Identity, costs and evidence hashes</a></p><pre>' + html.escape(json.dumps(summary["statistics"], indent=2)) + '</pre><table>' + rows + '</table>', encoding="utf-8")
    summary["evidence"] = [{"path": str(p.relative_to(out)).replace("\\", "/"), "sha256": sha256(p)} for p in sorted(out.rglob("*")) if p.is_file()]
    write_json(out / "summary.json", summary)
    print(json.dumps({"status": summary["status"], "tasks": len(corpus["tasks"]), "records": len(records), "rules_task_successes": summary["statistics"]["arms"]["rules"]["task_successes"], "model_calls": 0, "output": str(out)}))
    return 0 if summary["status"] == "completed" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", required=True)
    parser.add_argument("--runtime", default=str(ROOT / "services/audio-assistant"))
    parser.add_argument("--node", default="node")
    parser.add_argument("--output", required=True)
    parser.add_argument("--captures", help="Bounded offline actions; never executes a provider")
    args = parser.parse_args()
    try:
        return run(args)
    except (ValueError, OSError, RuntimeError, KeyError, TypeError, RecursionError) as exc:
        print(json.dumps({"status": "failed", "reason": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
