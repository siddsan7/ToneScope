"""Deterministic grouped corpus inventories; derived fixtures inherit parent split."""
import hashlib
import json
import math
import random

SPLITS = ("development", "validation", "locked-test")


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def assigned_split(group):
    # Stable bucket assignment is independent of order and all clip/variant names.
    bucket = int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) % 10
    return "development" if bucket < 6 else "validation" if bucket < 8 else "locked-test"


def validate_inventory(manifest):
    errors, groups, hashes, signatures = [], {}, {}, {}
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("items"), list):
        return ["invalid inventory schema"]
    seen = set()
    for item in manifest["items"]:
        required = ("id", "parent_group", "split", "sha256", "duplicate_signature", "license")
        if not isinstance(item, dict) or any(not isinstance(item.get(k), str) or not item[k] for k in required):
            errors.append("incomplete inventory item")
            continue
        if item["id"] in seen:
            errors.append("duplicate item ID")
        seen.add(item["id"])
        group, split = item["parent_group"], item["split"]
        if split not in SPLITS or split != assigned_split(group):
            errors.append("invalid group split assignment")
        if group in groups and groups[group] != split:
            errors.append("parent-group leakage")
        groups[group] = split
        for index, key in ((hashes, "sha256"), (signatures, "duplicate_signature")):
            token = item[key]
            if token in index and index[token] != split:
                errors.append("exact/near duplicate leakage")
            index[token] = split
    return errors


def signal_signature(samples):
    """Gain/polarity invariant quantized fingerprint for aligned derived duplicates.

    This is a conservative aligned check, not general perceptual deduplication.
    Crops/time warps must retain parent-group provenance; licensed recordings
    need independent similarity review before any final holdout qualification.
    """
    values = list(samples)
    scale = max(map(abs, values), default=0)
    polarity = next((1 if x > 0 else -1 for x in values if abs(x) > scale * .01), 1)
    return canonical_hash([round(x / scale * polarity, 3) if scale else 0 for x in values])


def synthetic(kind, seed, frames=4096, rate=48000):
    rng = random.Random(seed)
    if kind == "impulse":
        return [.75 if n == 17 else 0. for n in range(frames)]
    if kind == "step":
        return [.05 if n < frames // 2 else .5 for n in range(frames)]
    if kind == "noise":
        return [rng.uniform(-.5, .5) for _ in range(frames)]
    if kind == "sweep":
        # Linear chirp instantaneous frequency 30..0.4fs.
        slope = (.4 * rate - 30) / (frames / rate)
        return [.4 * math.sin(2 * math.pi * (30 * n / rate + .5 * slope * (n / rate) ** 2)) for n in range(frames)]
    raise ValueError("unknown synthetic family")
