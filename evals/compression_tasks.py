"""Frozen, inspectable threshold-only compression experiment (no model execution)."""
import math
from pathlib import Path
import re
import struct

from level_tasks import ROOT, ARMS, MODEL_ARMS, TABLE, canonical_hash, strict_json

CORPUS = ROOT / "evals/datasets/compression-tasks-v1.json"
LOCK = ROOT / "evals/datasets/compression-tasks-v1.lock.json"


def fixture_samples(spec, frames=192000):
    soft, hard = (struct.unpack("<f", bytes.fromhex(spec[k]))[0] for k in ("soft_float32_hex", "hard_float32_hex"))
    if any(not math.isfinite(x) or not 0 <= x <= 1 for x in (soft, hard)):
        raise ValueError("invalid frozen amplitude")
    if spec["kind"] not in ("table", "pulse"):
        raise ValueError("unknown compression source")
    return [[(soft if n < frames // 2 else hard) * (1 if c == 0 else .65)
             * (TABLE[(n * (1 if c == 0 else 3) + c * 7) % 64] / 32767 if spec["kind"] == "table" else (1 if n % 64 == c * 7 else 0))
             for n in range(frames)] for c in range(2)]


def load_corpus(path=CORPUS, lock=LOCK):
    path, lock = Path(path), Path(lock)
    if path.stat().st_size > 256 * 1024 or lock.stat().st_size > 4096:
        raise ValueError("oversized compression corpus")
    corpus, pinned = strict_json(path.read_text()), strict_json(lock.read_text())
    if canonical_hash(corpus) != pinned.get("corpus_sha256"):
        raise ValueError("frozen compression corpus digest mismatch")
    if (corpus.get("schema_version") != 1 or corpus.get("classification") != "inspectable-development-regression"
            or corpus.get("sample_rate") != 48000 or corpus.get("frames") != 192000
            or corpus.get("model_repetitions") != 3 or corpus.get("arms") != list(ARMS)
            or len(corpus.get("tasks", [])) != 16 or len(corpus.get("fixtures", {})) != 6):
        raise ValueError("invalid frozen compression experiment")
    seen = set()
    for task in corpus["tasks"]:
        identifier = task.get("task_id", "")
        if not re.fullmatch(r"[a-z0-9_-]{1,60}", identifier) or identifier in seen:
            raise ValueError("invalid compression task identity")
        seen.add(identifier)
        if (task["fixture_id"] not in corpus["fixtures"] or task["expected_status"] not in ("ready", "noop", "abstain")
                or task["parent_group"] != identifier or task["source_group"] != task["fixture_id"]
                or not isinstance(task["prompt"], str) or not 0 < len(task["prompt"].encode()) <= 8192):
            raise ValueError("invalid compression task")
        bounds = task["authorized_threshold_db"]
        if set(bounds) != {"value", "min", "max"} or not -60 <= bounds["min"] <= bounds["value"] <= bounds["max"] <= 0:
            raise ValueError("invalid threshold authorization")
        if task["tolerances"] != {"contrast_db": .5, "soft_db": .05, "peak_db": .05}:
            raise ValueError("unexpected compression tolerances")
        if task["objective"]["soft_max_change_db"] != .5 or task["objective"]["peak_ceiling_dbfs"] != -1:
            raise ValueError("unexpected compression constraints")
    return corpus
