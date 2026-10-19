"""Independent RMS and sample-peak grading for the frozen level benchmark.

Only WAV samples determine audio outcomes. Provider and product measurements are
not inputs. Zero energy has no finite dBFS value; no numerical floor is invented.
"""
import math
from pathlib import Path
import struct

try:
    from .oracles import read_wav, sha256
except ImportError:
    from oracles import read_wav, sha256


def measure_audio(path):
    rate, channels = read_wav(path)
    if not isinstance(rate, int) or rate <= 0 or not channels:
        raise ValueError("invalid audio format")
    frames = len(channels[0])
    if not frames or any(len(channel) != frames for channel in channels):
        raise ValueError("empty or unequal audio channels")
    if any(not math.isfinite(x) for channel in channels for x in channel):
        raise ValueError("nonfinite audio")
    energy = math.fsum(x * x for channel in channels for x in channel)
    rms = math.sqrt(energy / (frames * len(channels)))
    peak = max(abs(x) for channel in channels for x in channel)
    if not math.isfinite(rms) or not math.isfinite(peak):
        raise ValueError("nonfinite audio measurement")
    return {"sample_rate": rate, "channels": len(channels), "frames": frames,
            "rms": rms, "peak": peak,
            "rms_dbfs": 20 * math.log10(rms) if rms else None,
            "peak_dbfs": 20 * math.log10(peak) if peak else None,
            "audio_sha256": sha256(Path(path))}


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _authorized_patch(task, patch):
    if not isinstance(patch, list) or len(patch) != 1:
        return False
    entry = patch[0]
    if not isinstance(entry, dict) or set(entry) != {"stage_id", "parameter_id", "unit", "value"}:
        return False
    allowed = task["authorized_output_db"]
    return (entry["stage_id"] == "output" and entry["parameter_id"] == "outputDb"
            and entry["unit"] == "dB" and _number(entry["value"])
            and allowed["min"] <= entry["value"] <= allowed["max"])


def grade_audio(task, baseline_path, candidate_path=None, *, status, patch=None):
    """Grade decision and realized audio separately, without trusting a preview.

    A ready result requires one authorized output-gain patch and a rendered WAV.
    No-op evaluates the original WAV. Abstention is correct only for an explicitly
    abstain task. Failures and canceled requests never satisfy a task.
    """
    result = {"task_success": False, "decision_success": False, "audio_success": False,
              "critical": False, "errors": [], "baseline": None, "candidate": None,
              "observed_delta_db": None, "expected_delta_db": None}

    def error(message, critical=False):
        result["errors"].append(message)
        result["critical"] |= critical

    try:
        result["baseline"] = measure_audio(baseline_path)
    except (ValueError, OSError, OverflowError, ZeroDivisionError, struct.error) as exc:
        error("invalid_baseline_audio: " + str(exc), True)
        return result
    expected = task["expected_status"]
    result["decision_success"] = status == expected and status in ("ready", "noop", "abstain")
    if not result["decision_success"]:
        error("wrong_decision")
    if status == "ready":
        if not _authorized_patch(task, patch):
            error("unauthorized_patch", True)
        if candidate_path is None:
            error("missing_candidate_audio", True)
            return result
        try:
            result["candidate"] = measure_audio(candidate_path)
        except (ValueError, OSError, OverflowError, ZeroDivisionError, struct.error) as exc:
            error("invalid_candidate_audio: " + str(exc), True)
            return result
    else:
        if patch is not None and patch != []:
            error("patch_for_non_ready_status", True)
        if status == "abstain":
            result["audio_success"] = expected == "abstain"
            result["task_success"] = result["decision_success"] and not result["errors"]
            return result
        if status != "noop":
            error("no_audio_outcome")
            return result
        result["candidate"] = result["baseline"]

    baseline, candidate = result["baseline"], result["candidate"]
    if any(baseline[key] != candidate[key] for key in ("sample_rate", "channels", "frames")):
        error("audio_shape_mismatch", True)
        return result
    if status == "ready" and _authorized_patch(task, patch):
        try:
            _, original = read_wav(baseline_path)
            _, rendered = read_wav(candidate_path)
            gain = 10 ** ((patch[0]["value"] - task["authorized_output_db"]["value"]) / 20)
            maximum_error = max(abs(output - sample * gain)
                                for source, target in zip(original, rendered)
                                for sample, output in zip(source, target))
            result["waveform_max_abs"] = maximum_error
            if maximum_error > task["tolerances"].get("waveform_max_abs", 1e-6):
                error("output_gain_waveform_mismatch", True)
        except (ValueError, OSError, OverflowError, ZeroDivisionError, struct.error) as exc:
            error("invalid_audio_during_waveform_check: " + str(exc), True)
            return result
    objective = task["objective"]
    kind = objective["kind"]
    level_tolerance = task["tolerances"]["level_db"]
    peak_tolerance = task["tolerances"]["peak_db"]
    before, after = baseline["rms_dbfs"], candidate["rms_dbfs"]
    if before is not None and after is not None:
        result["observed_delta_db"] = after - before
    audio_ok = True
    if kind in ("delta", "target", "maximize"):
        if before is None or after is None:
            error("silence_has_no_finite_level")
            audio_ok = False
        else:
            if kind == "delta":
                expected_delta = objective["value_db"]
            elif kind == "target":
                expected_delta = objective["value_db"] - before
            else:
                allowed = task["authorized_output_db"]
                expected_delta = allowed["max"] - allowed["value"]
                if "peak_ceiling_dbfs" in objective:
                    expected_delta = min(expected_delta, objective["peak_ceiling_dbfs"] - baseline["peak_dbfs"])
                expected_delta = max(allowed["min"] - allowed["value"], expected_delta)
            result["expected_delta_db"] = expected_delta
            if abs(result["observed_delta_db"] - expected_delta) > level_tolerance:
                error("level_objective_missed")
                audio_ok = False
    elif kind != "none":
        error("unsupported_objective")
        audio_ok = False
    if ("peak_ceiling_dbfs" in objective and candidate["peak_dbfs"] is not None
            and candidate["peak_dbfs"] > objective["peak_ceiling_dbfs"] + peak_tolerance):
        error("sample_peak_ceiling_exceeded")
        audio_ok = False
    result["audio_success"] = audio_ok and not result["critical"]
    result["task_success"] = result["decision_success"] and audio_ok and not result["errors"]
    return result
