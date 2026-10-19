"""Independent passage RMS/sample-peak outcomes for a fixed compressor benchmark.

Waveform checks establish linked nonnegative attenuation relative to the baseline.
They do not prove a particular compressor algorithm or perceptual preference.
"""
import math
import struct

try:
    from .level_audio import measure_audio
    from .oracles import read_wav
except ImportError:
    from level_audio import measure_audio
    from oracles import read_wav

DECODE_ERRORS = (ValueError, OSError, OverflowError, ZeroDivisionError, struct.error)
RMS_AVAILABILITY = 1e-9
WAVEFORM_EPSILON = 1e-6


def _intervals(passages, selection_start, frames):
    if type(selection_start) is not int or selection_start < 0:
        raise ValueError("invalid selection start")
    if passages is None:
        return None
    if (not isinstance(passages, dict) or set(passages) != {"origin", "soft", "hard"}
            or passages["origin"] != "manual"):
        raise ValueError("passages require manual soft/hard intervals")
    spans = {}
    for name in ("soft", "hard"):
        interval = passages[name]
        if (not isinstance(interval, list) or len(interval) != 2
                or any(type(x) is not int for x in interval)
                or not selection_start <= interval[0] < interval[1] <= selection_start + frames
                or interval[1] - interval[0] < 2):
            raise ValueError("invalid " + name + " passage interval")
        spans[name] = [x - selection_start for x in interval]
    if max(spans["soft"][0], spans["hard"][0]) < min(spans["soft"][1], spans["hard"][1]):
        raise ValueError("passages overlap")
    return spans


def measure_passages(path, passages, selection_start=0):
    result = measure_audio(path)
    intervals = _intervals(passages, selection_start, result["frames"])
    result.update(soft=None, hard=None, contrast_db=None, selection_start=selection_start)
    if intervals is None:
        return result
    _, channels = read_wav(path)
    for name, (start, end) in intervals.items():
        rms = math.sqrt(math.fsum(x * x for channel in channels for x in channel[start:end])
                        / ((end - start) * len(channels)))
        peak = max(abs(x) for channel in channels for x in channel[start:end])
        if not math.isfinite(rms) or not math.isfinite(peak):
            raise ValueError("nonfinite passage measurement")
        result[name] = {"interval": passages[name], "relative_interval": [start, end],
                        "rms": rms, "peak": peak,
                        "rms_dbfs": 20 * math.log10(rms) if rms else None,
                        "peak_dbfs": 20 * math.log10(peak) if peak else None}
    if all(result[name]["rms"] >= RMS_AVAILABILITY for name in ("soft", "hard")):
        result["contrast_db"] = result["hard"]["rms_dbfs"] - result["soft"]["rms_dbfs"]
    return result


def _authorized_patch(task, patch):
    if not isinstance(patch, list) or len(patch) != 1:
        return False
    item = patch[0]
    if not isinstance(item, dict) or set(item) != {"stage_id", "parameter_id", "unit", "value"}:
        return False
    bounds = task["authorized_threshold_db"]
    value = item["value"]
    return (item["stage_id"] == "compressor" and item["parameter_id"] == "thresholdDb"
            and item["unit"] == "dBFS" and type(value) in (int, float)
            and math.isfinite(value) and bounds["min"] <= value <= bounds["max"])


def _linked_attenuation(baseline_path, candidate_path):
    _, baseline = read_wav(baseline_path)
    _, candidate = read_wav(candidate_path)
    max_error = 0.
    for source, target in zip(zip(*baseline), zip(*candidate)):
        dominant = max(range(len(source)), key=lambda c: abs(source[c]))
        if abs(source[dominant]) <= WAVEFORM_EPSILON:
            error = max(abs(x) for x in target)
        else:
            gain = target[dominant] / source[dominant]
            if gain < 0 or gain > 1 + WAVEFORM_EPSILON:
                return False, max_error
            error = max(abs(y - x * gain) for x, y in zip(source, target))
        max_error = max(max_error, error)
        if error > WAVEFORM_EPSILON:
            return False, max_error
    return True, max_error


def grade_compression(task, baseline, candidate=None, *, status, patch=None):
    result = {"task_success": False, "decision_success": False, "audio_success": False,
              "critical": False, "errors": [], "baseline": None, "candidate": None,
              "observed_reduction_db": None, "soft_change_db": None}

    def error(message, critical=False):
        result["errors"].append(message)
        result["critical"] |= critical

    passages, start = task.get("passages"), task.get("selection_start", 0)
    try:
        result["baseline"] = measure_passages(baseline, passages, start)
    except DECODE_ERRORS as exc:
        error("invalid_baseline_audio_or_passages: " + str(exc), True)
        return result
    expected = task["expected_status"]
    result["decision_success"] = status == expected and status in ("ready", "noop", "abstain")
    if not result["decision_success"]:
        error("wrong_decision")
    if status != "ready":
        if patch is not None and patch != []:
            error("patch_for_non_ready_status", True)
        if candidate is not None:
            error("candidate_for_non_ready_status", True)
        if status == "abstain":
            result["audio_success"] = expected == "abstain" and not result["critical"]
            result["task_success"] = result["decision_success"] and not result["errors"]
            return result
        if status != "noop":
            error("no_audio_outcome")
            return result
        result["candidate"] = result["baseline"]
    else:
        if not _authorized_patch(task, patch):
            error("unauthorized_patch", True)
        if candidate is None:
            error("missing_candidate_audio", True)
            return result
        try:
            # Measure overall audio first to report shape errors before validating coordinates.
            actual = measure_audio(candidate)
            if any(actual[k] != result["baseline"][k] for k in ("sample_rate", "channels", "frames")):
                error("audio_shape_mismatch", True)
                return result
            result["candidate"] = measure_passages(candidate, passages, start)
            linked, maximum_error = _linked_attenuation(baseline, candidate)
            result["linked_attenuation_max_abs"] = maximum_error
            if not linked:
                error("not_linked_nonnegative_attenuation", True)
        except DECODE_ERRORS as exc:
            error("invalid_candidate_audio: " + str(exc), True)
            return result
    before, after = result["baseline"], result["candidate"]
    audio_ok = True
    if before["contrast_db"] is None or after["contrast_db"] is None:
        error("missing_or_silent_passages")
        audio_ok = False
    else:
        objective, tolerance = task["objective"], task["tolerances"]
        reduction = before["contrast_db"] - after["contrast_db"]
        soft_change = after["soft"]["rms_dbfs"] - before["soft"]["rms_dbfs"]
        result.update(observed_reduction_db=reduction, soft_change_db=soft_change)
        if abs(reduction - objective["reduction_db"]) > tolerance["contrast_db"]:
            error("contrast_objective_missed")
            audio_ok = False
        if abs(soft_change) > objective["soft_max_change_db"] + tolerance["soft_db"]:
            error("soft_passage_level_changed")
            audio_ok = False
    if (after["peak_dbfs"] is not None and after["peak_dbfs"] >
            task["objective"]["peak_ceiling_dbfs"] + task["tolerances"]["peak_db"]):
        error("sample_peak_ceiling_exceeded")
        audio_ok = False
    result["audio_success"] = audio_ok and not result["critical"]
    result["task_success"] = result["decision_success"] and result["audio_success"] and not result["errors"]
    return result
