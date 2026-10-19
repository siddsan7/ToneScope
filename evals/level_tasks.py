"""Frozen development tasks and byte-stable synthetic sources for level evaluation."""
import hashlib
import json
import math
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "evals/datasets/level-tasks-v1.json"
LOCK = ROOT / "evals/datasets/level-tasks-v1.lock.json"
MODEL_ARMS = ("single-model-no-tools", "tool-grounded", "grounding-disabled")
ARMS = ("no-assistant", "rules", *MODEL_ARMS)
# Frozen integer sine table: source bytes do not depend on platform libm sin().
TABLE = (0,3212,6393,9512,12539,15446,18204,20787,23170,25329,27245,28898,30273,31356,32137,32609,
         32767,32609,32137,31356,30273,28898,27245,25329,23170,20787,18204,15446,12539,9512,6393,3212,
         0,-3212,-6393,-9512,-12539,-15446,-18204,-20787,-23170,-25329,-27245,-28898,-30273,-31356,-32137,-32609,
         -32767,-32609,-32137,-31356,-30273,-28898,-27245,-25329,-23170,-20787,-18204,-15446,-12539,-9512,-6393,-3212)


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key: " + key)
            result[key] = value
        return result
    def constant(value):
        raise ValueError("nonfinite JSON: " + value)
    value = json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    def finite(node):
        if isinstance(node, float) and not math.isfinite(node):
            raise ValueError("nonfinite JSON number")
        if isinstance(node, dict):
            for child in node.values():
                finite(child)
        if isinstance(node, list):
            for child in node:
                finite(child)
    finite(value)
    return value


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def fixture_samples(spec, frames=192000):
    amplitude = struct.unpack("<f", bytes.fromhex(spec["amplitude_float32_hex"]))[0]
    if not math.isfinite(amplitude) or not 0 <= amplitude <= 1:
        raise ValueError("invalid fixture amplitude")
    kind = spec["kind"]
    if kind == "silence":
        return [[0.] * frames for _ in range(2)]
    if kind == "impulse":
        return [[amplitude * (1. if channel == 0 else .65) if n % 4800 == 101 + channel * 13 else 0.
                 for n in range(frames)] for channel in range(2)]
    if kind not in ("sine-table", "multitone-table"):
        raise ValueError("unknown fixture kind")
    periods = []
    for channel in range(2):
        period = []
        for n in range(64):
            x = TABLE[(n * (1 if channel == 0 else 3) + channel * 7) % 64] / 32767
            if kind == "multitone-table":
                x += .25 * TABLE[(n * 7 + 11 + channel * 3) % 64] / 32767
                x += .125 * TABLE[(n * 13 + 17 + channel * 5) % 64] / 32767
            period.append(x * (1. if channel == 0 else .65))
        periods.append(period)
    peak = max(abs(x) for period in periods for x in period)
    return [[amplitude * period[n % 64] / peak for n in range(frames)] for period in periods]


def load_corpus(path=CORPUS, lock=LOCK):
    path, lock = Path(path), Path(lock)
    if path.stat().st_size > 256 * 1024 or lock.stat().st_size > 4096:
        raise ValueError("oversized corpus")
    corpus, pinned = strict_json(path.read_text()), strict_json(lock.read_text())
    if canonical_hash(corpus) != pinned.get("corpus_sha256"):
        raise ValueError("frozen corpus digest mismatch")
    if (corpus.get("schema_version") != 1 or corpus.get("classification") != "inspectable-development-regression"
            or corpus.get("sample_rate") != 48000 or corpus.get("frames") != 192000
            or corpus.get("model_repetitions") != 3 or corpus.get("arms") != list(ARMS)
            or len(corpus.get("tasks", [])) != 24):
        raise ValueError("invalid frozen experiment")
    fixtures = corpus["fixtures"]
    identifiers = set()
    categories = {}
    for task in corpus["tasks"]:
        identifier = task.get("task_id", "")
        if not re.fullmatch(r"[a-z0-9_-]{1,60}", identifier) or identifier in identifiers:
            raise ValueError("invalid or duplicate task identity")
        identifiers.add(identifier)
        if (task.get("fixture_id") not in fixtures or task.get("expected_status") not in ("ready", "noop", "abstain")
                or not isinstance(task.get("prompt"), str) or not 0 < len(task["prompt"].encode()) <= 8192
                or not isinstance(task.get("untrusted_label"), str)):
            raise ValueError("invalid task")
        if task.get("source_group") != fixtures[task["fixture_id"]]["source_group"] or task.get("parent_group") != identifier:
            raise ValueError("task/source provenance mismatch")
        bounds = task["authorized_output_db"]
        if (set(bounds) != {"value", "min", "max"} or any(type(v) not in (int, float) or not math.isfinite(v) for v in bounds.values())
                or not -24 <= bounds["min"] <= bounds["value"] <= bounds["max"] <= 24):
            raise ValueError("invalid output authorization")
        objective = task["objective"]
        if (objective.get("kind") not in ("delta", "target", "maximize", "none")
                or set(objective) - {"kind", "value_db", "peak_ceiling_dbfs"}
                or objective["kind"] in ("delta", "target") and type(objective.get("value_db")) not in (int, float)):
            raise ValueError("invalid task objective")
        if task["tolerances"] != {"level_db": .25, "peak_db": .05, "waveform_max_abs": 1e-6}:
            raise ValueError("unexpected level experiment tolerances")
        categories[task["category"]] = categories.get(task["category"], 0) + 1
    if categories != {"level": 8, "headroom": 4, "noop-silence": 4, "unsupported": 4, "injection": 4}:
        raise ValueError("incomplete task families")
    return corpus
