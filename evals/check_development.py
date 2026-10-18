"""CI-only protocol gate. Preserves blocked live qualification; never a release gate."""
import hashlib
import json
from pathlib import Path
import sys
from provenance import git, runtime_files, source_identity

ROOT = Path(__file__).resolve().parents[1]


def current_identity():
    sha = lambda name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    dirty = bool(git(ROOT, "status", "--porcelain"))
    return {"commit_sha": git(ROOT, "rev-parse", "HEAD"), "source_identity_sha256": source_identity(ROOT),
            "gates_sha256": sha("evals/gates.json"), "runner_sha256": sha("evals/run.py"),
            "oracle_sha256": sha("evals/oracles.py"), "runtime_files": runtime_files(ROOT, None),
            "working_tree_dirty": dirty, "started_working_tree_dirty": dirty,
            "compiled_identity": None, "cli_sha256": None}


def check(path):
    path = Path(path)
    run = json.loads(path.read_text(encoding="utf-8"))
    if (run.get("schema_version") != 1 or run.get("suite") != "ai-replay"
            or run.get("split") != "development" or run.get("status") != "blocked"
            or run.get("source_unchanged") is not True or run.get("runtime_unchanged") is not True):
        raise ValueError("Unexpected protocol run or changed evaluation inputs")
    if any(run.get(key) != value for key, value in current_identity().items()):
        raise ValueError("Protocol evidence is stale or does not match current source/runtime identities")
    results = run.get("results", [])
    expected = {"AI-PROTOCOL-BASELINES": "pass", "AI-LIVE-QUALIFICATION-PENDING": "blocked"}
    if len(results) != len(expected) or {case.get("case_id"): case.get("status") for case in results} != expected:
        raise ValueError("Missing/duplicate/failed protocol case or unexpected blocked qualification")
    case = next(case for case in results if case["case_id"] == "AI-PROTOCOL-BASELINES")
    evidence = case.get("evidence_paths", [])
    if not evidence:
        raise ValueError("Protocol evidence missing")
    root = path.parent.resolve()
    for item in evidence:
        asset = (root / item["path"]).resolve()
        if not asset.is_relative_to(root) or not asset.is_file() or hashlib.sha256(asset.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Protocol evidence escaped, missing or changed")
    return {"development_protocol_gate": "pass", "live_qualification": "blocked", "release_qualified": False}


if __name__ == "__main__":
    try:
        print(json.dumps(check(sys.argv[1])))
    except (ValueError, KeyError, OSError, TypeError, IndexError) as error:
        print(json.dumps({"development_protocol_gate": "fail", "error": str(error)}))
        sys.exit(1)
