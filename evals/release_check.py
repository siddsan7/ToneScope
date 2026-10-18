"""Fail-closed release evidence checks. Does not grant release authorization."""
import json
import math
import re
from pathlib import Path
from oracles import sha256

HASH = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
REQUIRED = {
    "schema_version": int, "product": str, "version": str, "edition": str,
    "commit_sha": str, "unsigned_payload": dict, "packaged_artifact": dict,
    "toolchain": dict, "dependencies": list, "dsp_generator": dict,
    "build_flags": list, "supported_profiles": list, "required_suites": list,
    "holdout_manifests": list, "manual_qualification": list, "open_defects": list,
    "blocked_checks": list, "notices": dict, "sbom": dict, "signature": dict,
    "attestation": dict, "baseline_changes": list, "reviewer_decisions": list,
    "installation_instructions": str, "rollback_instructions": str,
    "shipped_requirements": list, "critical_contract_boundaries": list,
}


def validate_manifest(path):
    errors = []
    try:
        manifest = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return [f"cannot read manifest: {exc}"]
    if not isinstance(manifest, dict):
        return ["manifest must be an object"]
    unknown = sorted(set(manifest) - set(REQUIRED))
    if unknown:
        errors.append("unknown manifest fields: " + ", ".join(unknown))
    for field, expected in REQUIRED.items():
        if type(manifest.get(field)) is not expected:
            errors.append(f"{field}: required {expected.__name__}")
        elif expected is str and not manifest[field].strip():
            errors.append(f"{field}: must be nonempty")
    if errors:
        return errors
    if manifest["schema_version"] != 1:
        errors.append("unsupported schema_version")
    if not COMMIT.fullmatch(manifest["commit_sha"]):
        errors.append("invalid commit_sha")
    base = Path(path).resolve().parent

    def file_ref(ref, label):
        if not isinstance(ref, dict) or not isinstance(ref.get("path"), str) or not isinstance(ref.get("sha256"), str):
            errors.append(f"{label}: expected path/sha256 object")
            return None
        target = (base / ref["path"]).resolve()
        if not HASH.fullmatch(ref["sha256"]):
            errors.append(f"{label}: invalid SHA-256")
        if not target.is_file():
            errors.append(f"{label}: evidence file missing")
            return None
        if sha256(target) != ref["sha256"]:
            errors.append(f"{label}: hash mismatch")
            return None
        return target

    for key in ("unsigned_payload", "packaged_artifact", "notices", "sbom"):
        file_ref(manifest[key], key)
    for key in ("toolchain", "dsp_generator"):
        value = manifest[key]
        if not all(isinstance(value.get(k), str) and value[k] for k in ("name", "version")):
            errors.append(f"{key}: name/version required")
    if not manifest["dependencies"]:
        errors.append("dependency inventory is empty")
    for dep in manifest["dependencies"]:
        if not isinstance(dep, dict) or not all(dep.get(k) for k in ("name", "version", "sha256", "license")) or not HASH.fullmatch(str(dep.get("sha256", ""))):
            errors.append("dependency requires name/version/hash/license")
    for key in ("signature", "attestation"):
        item = manifest[key]
        if item.get("status") != "verified":
            errors.append(f"{key}: must have verified evidence")
        file_ref(item.get("evidence"), key + ".evidence")
    if manifest["blocked_checks"]:
        errors.append("blocked checks prevent release")
    for defect in manifest["open_defects"]:
        if not isinstance(defect, dict) or not defect.get("id") or defect.get("severity") not in ("minor", "major") or not defect.get("reviewer_acceptance"):
            errors.append("open defect lacks explicit noncritical reviewer acceptance")
    if not manifest["supported_profiles"]:
        errors.append("supported_profiles is empty")
    for profile in manifest["supported_profiles"]:
        file_ref(profile, "supported profile")
    if not manifest["holdout_manifests"]:
        errors.append("holdout manifest evidence missing")
    for ref in manifest["holdout_manifests"]:
        file_ref(ref, "holdout manifest")
    required_manual = {"hardware", "listening", "accessibility", "installation"}
    kinds = set()
    for ref in manifest["manual_qualification"]:
        target = file_ref(ref, "manual qualification")
        if target:
            try:
                record = json.loads(target.read_text(encoding="utf-8"))
                if record.get("schema_version") != 1 or record.get("status") != "pass" or not all(record.get(k) for k in ("record_id", "operator", "date", "observations", "profile_id")):
                    errors.append("manual qualification is incomplete or nonpassing")
                kinds.add(record.get("kind"))
            except (ValueError, AttributeError):
                errors.append("manual qualification must be a structured record")
    if required_manual - kinds:
        errors.append("missing manual qualification kinds: " + ", ".join(sorted(required_manual - kinds)))
    decisions = manifest["reviewer_decisions"]
    if not decisions or not any(isinstance(d, dict) and d.get("decision") == "approve" and
                                d.get("reviewer") and d.get("date") and d.get("commit_sha") == manifest["commit_sha"] for d in decisions):
        errors.append("explicit reviewer approval for this commit is required")
    mapping = json.loads((Path(__file__).parent / "coverage.json").read_text())["requirements"]
    families, cases, suites = set(), {}, set()
    if not manifest["required_suites"]:
        errors.append("required_suites is empty")
    for ref in manifest["required_suites"]:
        target = file_ref(ref, "suite")
        if not target:
            continue
        try:
            run = json.loads(target.read_text(encoding="utf-8"))
            if run.get("schema_version") != 1 or run.get("status") != "pass" or run.get("commit_sha") != manifest["commit_sha"] or not run.get("run_id"):
                errors.append("suite must pass at the manifest commit")
            if run.get("working_tree_dirty") is not False:
                errors.append("release suite must come from a clean working tree")
            for identity in ("cli_sha256", "runner_sha256", "oracle_sha256"):
                if not HASH.fullmatch(str(run.get(identity, ""))):
                    errors.append(f"suite lacks {identity}")
            suites.add(run.get("suite"))
            if not isinstance(run.get("results"), list) or not run["results"]:
                errors.append("suite has no case evidence")
                continue
            for case in run["results"]:
                if not isinstance(case, dict) or case.get("status") != "pass" or case.get("commit_sha") != manifest["commit_sha"] or case.get("run_id") != run.get("run_id"):
                    errors.append("suite contains nonpassing/inconsistent case")
                    continue
                def valid_measurements(value):
                    if value is None or type(value) is bool:
                        return True
                    if type(value) is int:
                        return True
                    if type(value) is float:
                        return math.isfinite(value)
                    if isinstance(value, dict):
                        return all(isinstance(k, str) and valid_measurements(v) for k, v in value.items())
                    if isinstance(value, list):
                        return all(valid_measurements(v) for v in value)
                    return False
                measurements = case.get("measurements")
                if (case.get("schema_version") != 1 or not isinstance(case.get("case_id"), str)
                    or not isinstance(case.get("oracle_version"), str) or not case["oracle_version"]
                    or not isinstance(measurements, dict) or not measurements or not valid_measurements(measurements)
                    or not isinstance(case.get("evidence_paths"), list) or not case["evidence_paths"]
                    or not isinstance(case.get("families"), list) or not all(isinstance(f, str) for f in case["families"])):
                    errors.append("passing case lacks oracle, measurements or evidence")
                    continue
                verified = True
                for evidence in case["evidence_paths"]:
                    if not isinstance(evidence, dict):
                        verified = False
                        break
                    local_ref = dict(evidence)
                    local_ref["path"] = str(target.parent / str(evidence.get("path", "")))
                    if not file_ref(local_ref, "case evidence"):
                        verified = False
                if verified:
                    families.update(case.get("families", []))
                    cases[case.get("case_id")] = case
        except (ValueError, TypeError, AttributeError):
            errors.append("invalid structured suite evidence")
    must_suites = {"contracts", "dsp", "integration"}
    if "TS-015" in manifest["shipped_requirements"]:
        must_suites |= {"ai-replay", "ai-live"}
    if must_suites - suites:
        errors.append("missing required suites: " + ", ".join(sorted(must_suites - suites)))
    if not manifest["shipped_requirements"]:
        errors.append("shipped_requirements is empty")
    for requirement in manifest["shipped_requirements"]:
        if requirement not in mapping:
            errors.append(f"unknown shipped requirement {requirement}")
        elif set(mapping[requirement]) - families:
            errors.append(f"{requirement}: missing passing families {sorted(set(mapping[requirement]) - families)}")
    if not manifest["critical_contract_boundaries"]:
        errors.append("critical contract boundary inventory is empty")
    for boundary in manifest["critical_contract_boundaries"]:
        if not isinstance(boundary, dict) or not boundary.get("id") or not boundary.get("case_ids") or any(c not in cases for c in boundary.get("case_ids", [])):
            errors.append("critical contract boundary lacks passing validator cases")
    return errors
