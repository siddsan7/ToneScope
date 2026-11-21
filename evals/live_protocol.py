"""Offline protocol gate. Validation never initializes a provider or authorizes spend."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from level_tasks import canonical_hash, strict_json, load_corpus as level_corpus
from compression_tasks import load_corpus as compression_corpus

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / "evals/live_protocol.json"
LOCK = ROOT / "evals/live_protocol.lock.json"
SPEC = ROOT / "delivery/live-model-protocol.md"


def production_limits(source, policy_source=""):
    """Read only supported constant syntax; follow the actual imported spread."""
    def fields(text, name, spreads):
        match = re.search(r"export const " + name + r"=Object.freeze\(\{([^}]+)\}\)", text)
        if not match:
            raise ValueError("production limits unavailable")
        result = {}
        for token in match[1].split(","):
            token = token.strip()
            if not token:
                continue
            if token in spreads:
                result.update(spreads[token])
                continue
            literal = re.fullmatch(r"(\w+)\s*:\s*(\d+)", token)
            if not literal:
                raise ValueError("unsupported production limits expression")
            result[literal[1]] = int(literal[2])
        return result
    spreads = {}
    if "...LIVE_LIMITS" in source:
        if not re.search(r"import\s*\{[^}]*\bLIVE_LIMITS\b[^}]*\}\s*from\s*['\"]\./live-policy\.ts['\"]", source):
            raise ValueError("production limits import unavailable")
        spreads["...LIVE_LIMITS"] = fields(policy_source, "LIVE_LIMITS", {})
    return fields(source, "LIMITS", spreads)


def validate(protocol=PROTOCOL, lock=LOCK):
    protocol, lock = Path(protocol), Path(lock)
    if protocol.stat().st_size > 32768 or lock.stat().st_size > 4096:
        raise ValueError("oversized protocol")
    value = strict_json(protocol.read_text(encoding="utf-8"))
    pinned = strict_json(lock.read_text(encoding="utf-8"))
    digest = canonical_hash(value)
    if digest != pinned.get("protocol_sha256"):
        raise ValueError("frozen protocol digest mismatch")
    if hashlib.sha256(SPEC.read_text(encoding="utf-8").encode("utf-8")).hexdigest() != pinned.get("spec_sha256"):
        raise ValueError("frozen protocol specification digest mismatch")
    if value["schema_version"] != 1 or value["live_authorized"] is not False:
        raise ValueError("protocol cannot authorize live execution")
    # Compare to the actual production service, not a second list of limits.
    source = (ROOT / "services/audio-assistant/agent/lib/service.ts").read_text(encoding="utf-8")
    policy_source = (ROOT / "services/audio-assistant/agent/lib/live-policy.ts").read_text(encoding="utf-8")
    actual = production_limits(source, policy_source)
    if any(actual.get(key) != number for key, number in value["limits"].items()):
        raise ValueError("production limits drift")
    schedule = value["schedule"]
    if (len(level_corpus()["tasks"]) != schedule["development_level_tasks"]
            or len(compression_corpus()["tasks"]) != schedule["development_compression_tasks"]):
        raise ValueError("development corpus count drift")
    scored = sum(schedule[key] for key in ("development_level_tasks", "development_compression_tasks", "transfer_tasks")) * schedule["repetitions"]
    maximum = scored + schedule["setup_requests"] + schedule["lifecycle_requests"]
    if (scored != schedule["scored_requests"] or maximum != schedule["maximum_requests"]
            or maximum * value["limits"]["tool_calls"] != schedule["maximum_generations"]):
        raise ValueError("request or generation denominator mismatch")
    visited = set()
    for stage, dependencies in value["stages"].items():
        if len(set(dependencies)) != len(dependencies) or not set(dependencies) <= visited:
            raise ValueError("stage dependency missing, cyclic or out of order")
        visited.add(stage)
    return {"status": "passed", "protocol_sha256": digest, "scored_requests": scored,
            "maximum_requests": maximum, "live_authorized": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, default=PROTOCOL)
    parser.add_argument("--lock", type=Path, default=LOCK)
    args = parser.parse_args()
    print(json.dumps(validate(args.protocol, args.lock), indent=2))
