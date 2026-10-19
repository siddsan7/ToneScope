"""Offline-first level experiment: real native baselines and independent WAV grades.

No live provider can be instantiated here. Captured actions are replay inputs,
not authenticated evidence of model origin. This runner never qualifies release.
"""
import argparse
import datetime
import hashlib
import html
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

from ai import clustered_interval
from level_audio import grade_audio, measure_audio
from level_tasks import ARMS, MODEL_ARMS, ROOT, canonical_hash, fixture_samples, load_corpus, strict_json
from oracles import sha256, write_float_wav
from provenance import compiled_identity, git, runtime_files, source_identity


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def record_baseline_failure(out, folder, task, repetitions, captures, error):
    """Keep every scheduled record even when the shared native baseline fails."""
    records = []
    for arm in ARMS:
        for repeat in range(1 if arm in ("rules", "no-assistant") else repetitions):
            case = folder / (arm + "-" + str(repeat))
            case.mkdir()
            blocked = arm in MODEL_ARMS and (task["task_id"], arm, repeat) not in captures
            record = {"task_id": task["task_id"], "parent_group": task["parent_group"], "source_group": task["source_group"],
                      "category": task["category"], "expected_status": task["expected_status"], "arm": arm, "repeat": repeat,
                      "status": "blocked" if blocked else "failed", "grade": None, "infrastructure_error": error,
                      "reason": "baseline_unavailable_paid_execution_disabled_no_capture" if blocked else "baseline_unavailable",
                      "actual_model_calls": 0, "actual_model_cost_usd": 0,
                      "record_path": str((case / "record.json").relative_to(out)).replace("\\", "/")}
            write_json(case / "record.json", record)
            records.append(record)
    return records


def load_captures(path, corpus):
    if path is None:
        return {}
    path = Path(path)
    if path.stat().st_size > 5 * 1024 * 1024:
        raise ValueError("capture file exceeds five MiB")
    value = strict_json(path.read_text(encoding="utf-8-sig"))
    if (not isinstance(value, dict) or set(value) != {"schema_version", "corpus_sha256", "records"}
            or value["schema_version"] != 1 or value["corpus_sha256"] != canonical_hash(corpus)
            or not isinstance(value["records"], list) or len(value["records"]) > 216):
        raise ValueError("invalid capture envelope or corpus identity")
    tasks = {t["task_id"] for t in corpus["tasks"]}
    records = {}
    for record in value["records"]:
        if (not isinstance(record, dict) or set(record) != {"task_id", "arm", "repeat", "capture"}
                or record["task_id"] not in tasks or record["arm"] not in MODEL_ARMS
                or type(record["repeat"]) is not int or not 0 <= record["repeat"] < 3):
            raise ValueError("invalid capture task/arm/repetition")
        key = (record["task_id"], record["arm"], record["repeat"])
        if key in records:
            raise ValueError("duplicate capture identity")
        capture = record["capture"]
        if (not isinstance(capture, dict) or set(capture) - {"schema_version", "provenance", "actions", "historical_usage"}
                or capture.get("schema_version") != 1 or not isinstance(capture.get("actions"), list)
                or not 0 < len(capture["actions"]) <= 8 or not isinstance(capture.get("provenance"), dict)
                or capture["provenance"].get("kind") not in ("imported-capture", "scripted-test")
                or not isinstance(capture["provenance"].get("model"), str)):
            raise ValueError("invalid captured actions or provenance")
        records[key] = capture
    return records


def decision_context(request, snapshot, baseline, task, arm):
    # Evaluator objectives, expected outcomes and fixture recipes never enter here.
    measurements = [{"measurement_id": name, "value": max(-240., baseline[name] if baseline[name] is not None else -240.), "unit": "dBFS"}
                    for name in ("rms_dbfs", "peak_dbfs")]
    return {"request": request, "snapshot": snapshot,
            "measurements": {"available": False, "reason": "grounding_disabled"} if arm == "grounding-disabled" else measurements,
            "untrusted_label": task["untrusted_label"],
            "measurement_note": "Independent export of native baseline audio; zero uses the adapter's minus two hundred forty dBFS floor. Grading preserves silence as unavailable."}


def summarize(records):
    result = {}
    for arm in ARMS:
        rows = [r for r in records if r["arm"] == arm]
        graded = [r for r in rows if r.get("grade") is not None]
        attempted = [r for r in rows if r["status"] != "blocked"]
        feasible = [r for r in attempted if r["expected_status"] != "abstain"]
        boundaries = [r for r in attempted if r["expected_status"] == "abstain"]
        intervals = [{"task_id": r["task_id"], "score": int((r.get("grade") or {}).get("task_success", False))} for r in feasible]
        result[arm] = {"scheduled_records": len(rows), "graded_records": len(graded),
                       "blocked_records": sum(r["status"] == "blocked" for r in rows),
                       "task_successes": sum(r["grade"]["task_success"] for r in graded),
                       "feasible_tasks": len(feasible), "feasible_task_successes": sum((r.get("grade") or {}).get("task_success", False) for r in feasible),
                       "decision_successes": sum(r["grade"]["decision_success"] for r in graded),
                       "audio_successes": sum(r["grade"].get("audio_success", False) for r in graded),
                       "infrastructure_failures": sum(r["status"] == "failed" for r in rows),
                       "correct_boundary_decisions": sum((r.get("grade") or {}).get("decision_success", False) for r in boundaries) if arm != "no-assistant" else None,
                       "boundary_tasks": len(boundaries),
                       "runtime_failures": sum(r["status"] == "failed" or r.get("response_status") in ("failed", "timed_out", "canceled") for r in rows),
                       "critical_grades": sum(r["grade"]["critical"] for r in graded),
                       "raw_action_rejections": sum(bool(r.get("rejection_errors")) for r in graded),
                       "feasible_task_cluster_interval": clustered_interval(intervals),
                       "classification": "deterministic-baseline" if arm in ("rules", "no-assistant") else "offline-capture-origin-unverified",
                       "actual_model_calls": 0, "actual_model_tokens": 0, "actual_model_cost_usd": 0,
                       "model_latency_ms": None}
    by_key = {(r["task_id"], r["arm"], r["repeat"]): r for r in records if r["status"] != "blocked"}
    def score(row):
        return int((row.get("grade") or {}).get("task_success", False))
    paired = []
    for task_id, arm, repeat in by_key:
        if arm == "rules" and (task_id, "no-assistant", 0) in by_key:
            a, b = by_key[(task_id, arm, repeat)], by_key[(task_id, "no-assistant", 0)]
            if a["expected_status"] != "abstain":
                paired.append({"task_id": task_id, "score": score(a) - score(b)})
    comparisons = {}
    for left, right in ((arm, baseline) for arm in MODEL_ARMS for baseline in ("no-assistant", "rules")):
        pairs = []
        for (task_id, arm, repeat), row in by_key.items():
            other = by_key.get((task_id, right, 0))
            if arm == left and other is not None and row["expected_status"] != "abstain":
                pairs.append({"task_id": task_id, "score": score(row) - score(other)})
        comparisons[left + "_minus_" + right] = clustered_interval(pairs)
    pairs = []
    for (task_id, arm, repeat), row in by_key.items():
        other = by_key.get((task_id, "grounding-disabled", repeat))
        if arm == "tool-grounded" and other is not None and row["expected_status"] != "abstain":
            pairs.append({"task_id": task_id, "score": score(row) - score(other)})
    comparisons["tool-grounded_minus_grounding-disabled"] = clustered_interval(pairs)
    return {"arms": result, "paired_feasible_rules_minus_unchanged": clustered_interval(paired),
            "paired_feasible_capture_comparisons": comparisons,
            "comparison_coverage": "Only matched attempted records; partial captures are not full-corpus model estimates. Failed attempts count as zero. Blocked records are never successes.",
            "interval_scope": "Task-cluster bootstrap; repeated actions are not independent tasks. Six synthetic source groups are not independent musical performances."}


def render_report(out, summary, records):
    rows = []
    for record in records:
        outcome = "blocked" if record["status"] == "blocked" else "success" if (record.get("grade") or {}).get("task_success") else "miss/failure"
        rows.append("<tr>" + "".join("<td>" + html.escape(str(x)) + "</td>" for x in
                    (record["task_id"], record["arm"], record["repeat"], outcome)) +
                    '<td><a href="' + html.escape(record["record_path"]) + '">record</a></td></tr>')
    (out / "report.html").write_text('<!doctype html><meta charset="utf-8"><title>ToneScope level evaluation</title>'
        '<style>body{font:16px/1.5 system-ui;max-width:1100px;margin:30px auto;padding:20px}td,th{padding:5px 12px;border-bottom:1px solid #bbb}pre{white-space:pre-wrap}</style>'
        '<h1>Level evaluation: offline native evidence</h1><p>Real baseline audio, independent grades. Model execution is disabled. Imported actions are not authenticated model runs. '
        'This is inspectable development regression data, not a holdout or release qualification. Baseline task misses do not imply a broken evaluator.</p>'
        '<p><a href="summary.json">Identity, costs, failures and evidence hashes</a></p><pre>' + html.escape(json.dumps(summary["statistics"], indent=2)) +
        '</pre><table><tr><th>Task</th><th>Arm</th><th>Repeat</th><th>Outcome</th><th>Evidence</th></tr>' + "".join(rows) + '</table>', encoding="utf-8")


def evaluate(args):
    corpus = load_corpus()
    captures = load_captures(args.captures, corpus)
    out, cli, runtime = Path(args.output).resolve(), Path(args.cli).resolve(), Path(args.runtime).resolve()
    if out.exists():
        raise ValueError("output already exists; outcomes are never overwritten")
    if not cli.is_file() or not (runtime / "agent/lib/service.ts").is_file() or not (runtime / "node_modules/zod/package.json").is_file():
        raise ValueError("native executable or installed assistant runtime unavailable")
    node = shutil.which(args.node)
    if node is None:
        raise ValueError("Node runtime unavailable")
    compiled = compiled_identity(cli)
    source = source_identity(ROOT)
    if not compiled or compiled.get("commit_sha") != git(ROOT, "rev-parse", "HEAD") or compiled.get("source_identity_sha256") != source:
        raise ValueError("renderer source identity is stale; rebuild the CLI before evaluating")
    out.mkdir(parents=True, exist_ok=False)
    (out / "sources").mkdir()
    (out / "cases").mkdir()
    inventory = runtime_files(ROOT, cli)
    inventory += [{"path": str(p.resolve()), "sha256": sha256(p)} for p in
                  [ROOT / "evals/level_bridge.mjs", Path(node), runtime / "package-lock.json", *sorted((runtime / "agent/lib").glob("*.ts")),
                   *sorted(p for p in (runtime / "node_modules/zod").rglob("*") if p.is_file())]]
    records, infrastructure = [], []
    env = {k: v for k, v in os.environ.items() if k not in
           ("AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "NODE_OPTIONS", "NODE_PATH")}
    env["TONESCOPE_ENABLE_LIVE"] = "0"
    node_version = subprocess.check_output([node, "--version"], text=True, timeout=5, env=env).strip()
    if not node_version.startswith("v24."):
        raise ValueError("Node 24 is required by the assistant lockfile")
    if captures:
        write_json(out / "accepted-captures.json", {"schema_version": 1, "corpus_sha256": canonical_hash(corpus), "records": [
            {"task_id": k[0], "arm": k[1], "repeat": k[2], "capture": v} for k, v in sorted(captures.items())]})
    sources = {}
    for identifier, spec in corpus["fixtures"].items():
        path = out / "sources" / (identifier + ".wav")
        write_float_wav(path, fixture_samples(spec, corpus["frames"]), corpus["sample_rate"])
        if sha256(path) != spec["sha256"]:
            raise ValueError("frozen source bytes changed: " + identifier)
        sources[identifier] = path

    def command(argv, folder, name, timeout=75):
        start = time.monotonic()
        try:
            process = subprocess.run([str(x) for x in argv], capture_output=True, text=True, timeout=timeout, env=env)
            value = {"argv": [str(x) for x in argv], "exit_code": process.returncode, "stdout": process.stdout,
                     "stderr": process.stderr, "elapsed_ms": (time.monotonic() - start) * 1000, "timed_out": False}
        except subprocess.TimeoutExpired as exc:
            value = {"argv": [str(x) for x in argv], "exit_code": None, "stdout": str(exc.stdout or ""),
                     "stderr": str(exc.stderr or ""), "elapsed_ms": (time.monotonic() - start) * 1000, "timed_out": True}
        write_json(folder / (name + "-process.json"), value)
        if value["exit_code"] != 0 or len(value["stdout"].encode()) > 2 * 1024 * 1024:
            raise RuntimeError("child failed/timeout/oversized response: " + name)
        return strict_json(value["stdout"])

    for task in corpus["tasks"]:
        folder = out / "cases" / task["task_id"]
        folder.mkdir()
        source_path = sources[task["fixture_id"]]
        parameters = {"outputDb": task["authorized_output_db"]["value"]}
        config, baseline_path = folder / "baseline-session.json", folder / "baseline.wav"
        write_json(config, {"schema_version": 1, "source_sha256": sha256(source_path), "parameters": parameters})
        try:
            manifest = command([cli, "render", "--source", source_path, "--out", baseline_path, "--session", config], folder, "baseline")
            if (manifest["artifact_sha256"] != sha256(baseline_path) or manifest["source_sha256"] != sha256(source_path)):
                raise ValueError("baseline provenance mismatch")
            baseline = measure_audio(baseline_path)
            if (baseline["frames"], baseline["channels"], baseline["sample_rate"]) != (corpus["frames"], 2, corpus["sample_rate"]):
                raise ValueError("baseline audio shape mismatch")
        except (ValueError, RuntimeError, OSError, KeyError) as exc:
            infrastructure.append({"task_id": task["task_id"], "error": str(exc)})
            write_json(folder / "infrastructure-error.json", infrastructure[-1])
            records.extend(record_baseline_failure(out, folder, task, corpus["model_repetitions"], captures, str(exc)))
            continue
        for arm in ARMS:
            for repeat in range(1 if arm in ("rules", "no-assistant") else corpus["model_repetitions"]):
                run_folder = folder / (arm + "-" + str(repeat))
                run_folder.mkdir()
                identifier = task["task_id"].replace("-", "_") + "_" + str(repeat)
                snapshot = {"session_id": "level_" + identifier, "session_revision": 1,
                            "source_sha256": sha256(source_path), "base_graph_sha256": manifest["graph_sha256"],
                            "source_handle": "asset_" + task["fixture_id"], "selection_samples": [0, corpus["frames"]],
                            "sample_rate": corpus["sample_rate"], "parameters": [{"stage_id": "output", "parameter_id": "outputDb", "unit": "dB", **task["authorized_output_db"]}]}
                request = {"schema_version": 1, "request_id": "request_" + identifier, "session_id": snapshot["session_id"], "prompt": task["prompt"]}
                view = decision_context(request, snapshot, baseline, task, arm)
                write_json(run_folder / "request-context.json", view)
                record = {"task_id": task["task_id"], "parent_group": task["parent_group"], "source_group": task["source_group"],
                          "category": task["category"], "expected_status": task["expected_status"], "arm": arm, "repeat": repeat,
                          "status": "completed", "grade": None, "actual_model_calls": 0, "actual_model_cost_usd": 0,
                          "request_context_sha256": canonical_hash(view), "historical_usage": None,
                          "record_path": str((run_folder / "record.json").relative_to(out)).replace("\\", "/")}
                capture = captures.get((task["task_id"], arm, repeat))
                if arm in MODEL_ARMS and capture is None:
                    record.update(status="blocked", reason="paid_model_execution_disabled_no_capture", model_latency_ms=None)
                else:
                    try:
                        if arm == "no-assistant":
                            status, patch, candidate = "noop", None, None
                            record["response_status"] = status
                        else:
                            fixture = {"schema_version": 1, "arm": arm, "request": request, "snapshot": snapshot,
                                       "asset": {"snapshot": snapshot, "source_path": str(source_path), "baseline_path": str(baseline_path), "parameters": parameters},
                                       "untrusted_label": task["untrusted_label"]}
                            if capture is not None:
                                fixture["capture"] = capture
                            write_json(run_folder / "bridge-input.json", fixture)
                            bridge = command([node, "--experimental-strip-types", ROOT / "evals/level_bridge.mjs", runtime, cli, run_folder], run_folder, "bridge")
                            response = bridge.get("response")
                            record.update(mode_classification=bridge["mode_classification"], rejection_errors=bridge.get("rejection_errors", []),
                                          raw_actions=bridge["raw_actions"], historical_usage=bridge.get("historical_usage"),
                                          bridge_status=bridge["status"], response_status=response["status"] if response else "failed",
                                          usage=response["usage"] if response else None)
                            record["evaluation_wrapper"] = bridge.get("evaluation_wrapper", False)
                            record["proposal_origin"] = bridge.get("proposal_origin")
                            record["capture_classification"] = bridge.get("capture_classification")
                            if capture is not None:
                                record["capture_provenance"] = capture["provenance"]
                            status = record["response_status"]
                            patch = response["proposal"]["parameter_patch"] if response and response.get("proposal") else None
                            candidate = bridge.get("preview_path")
                            if candidate is not None:
                                candidate = Path(candidate).resolve()
                                if not candidate.is_relative_to(run_folder / "previews") or sha256(candidate) != response["preview"]["audio_sha256"]:
                                    raise ValueError("candidate path/digest binding failed")
                        record["grade"] = grade_audio(task, baseline_path, candidate, status=status, patch=patch)
                    except (ValueError, RuntimeError, OSError, KeyError, TypeError) as exc:
                        record.update(status="failed", infrastructure_error=str(exc))
                        infrastructure.append({"task_id": task["task_id"], "arm": arm, "repeat": repeat, "error": str(exc)})
                write_json(run_folder / "record.json", record)
                records.append(record)

    unchanged = source == source_identity(ROOT) and all(Path(p["path"]).is_file() and sha256(p["path"]) == p["sha256"] for p in inventory)
    summary = {"schema_version": 1, "kind": "native-level-development-experiment", "status": "completed" if unchanged and not infrastructure else "failed",
               "classification": corpus["classification"], "holdout_qualified": False, "release_qualified": False,
               "live_qualification": "blocked", "paid_execution_enabled": False, "actual_model_calls": 0, "actual_model_cost_usd": 0,
               "created_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "corpus_sha256": canonical_hash(corpus),
               "corpus_tasks": len(corpus["tasks"]), "source_groups": len(corpus["fixtures"]), "records": len(records),
               "model_repetitions": corpus["model_repetitions"], "compiled_identity": compiled, "source_identity_sha256": source,
               "source_and_runtime_unchanged": unchanged, "working_tree_dirty": bool(git(ROOT, "status", "--porcelain")),
               "runtime_files": inventory, "infrastructure_errors": infrastructure, "statistics": summarize(records),
               "node_version": node_version, "python_version": sys.version.split()[0], "platform": platform.platform(),
               "limitations": ["Synthetic inspectable tasks; not representative music or a holdout.", "Imported capture provenance is not authenticated.",
                               "Replay latency is not model latency; historical usage is metadata, not current spend.",
                               "The rules baseline uses bounded level grammar; unsupported phrasing can abstain.",
                               "RMS/sample peak do not establish perceived loudness/true peak or musical preference."], "evidence": []}
    render_report(out, summary, records)
    summary["evidence"] = [{"path": str(p.relative_to(out)).replace("\\", "/"), "sha256": sha256(p)} for p in sorted(out.rglob("*")) if p.is_file()]
    write_json(out / "summary.json", summary)
    print(json.dumps({"status": summary["status"], "tasks": len(corpus["tasks"]), "records": len(records), "model_calls": 0,
                      "rules_task_successes": summary["statistics"]["arms"]["rules"]["task_successes"], "output": str(out)}))
    return 0 if summary["status"] == "completed" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", required=True)
    parser.add_argument("--runtime", default=str(ROOT / "services/audio-assistant"))
    parser.add_argument("--node", default="node")
    parser.add_argument("--output", required=True)
    parser.add_argument("--captures", help="Bounded offline captured actions; never executes a provider")
    args = parser.parse_args()
    try:
        return evaluate(args)
    except (ValueError, OSError, RuntimeError, KeyError, TypeError, RecursionError) as exc:
        print(json.dumps({"status": "failed", "reason": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
