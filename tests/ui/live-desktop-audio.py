"""Independent WAV outcomes for the public desktop lifecycle probes only."""
import argparse
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'evals'))
from compression_audio import grade_compression
from oracles import read_wav, flatten, rms


def grade(trace_file, family, expected):
    trace = json.loads(Path(trace_file).read_text())
    directory = Path(trace_file).parent
    baseline = directory / trace['baseline_audio']['file']
    candidate = directory / trace['candidate_audio']['file']
    gates = json.loads((ROOT / 'evals/live_protocol.json').read_text())['audio_gates']
    if family == 'compression':
        task = {'expected_status': 'ready', 'passages': trace['snapshot']['passages'],
                'authorized_threshold_db': {'min': -60, 'max': 0},
                'objective': {'reduction_db': 3, 'soft_max_change_db': 0.5, 'peak_ceiling_dbfs': -1},
                'tolerances': {'contrast_db': 0.5, 'soft_db': 0.05, 'peak_db': 0.05}}
        assert task['tolerances']['contrast_db'] == gates['contrast_db']
        assert task['objective']['soft_max_change_db'] + task['tolerances']['soft_db'] == gates['soft_rms_db']
        assert task['objective']['peak_ceiling_dbfs'] + task['tolerances']['peak_db'] == gates['compression_peak_dbfs']
        threshold = -24 if expected == 'objective-miss' else -20.5
        report = grade_compression(task, baseline, candidate, status='ready', patch=[{
            'stage_id': 'compressor', 'parameter_id': 'thresholdDb', 'unit': 'dBFS', 'value': threshold}])
        if expected == 'objective-miss':
            assert not report['task_success'] and report['errors'] == ['contrast_objective_missed'], report
        else:
            assert report['task_success'], report
    else:
        rate_b, channels_b = read_wav(baseline)
        rate_c, channels_c = read_wav(candidate)
        assert rate_b == rate_c and len(channels_b) == len(channels_c)
        assert all(len(b) == len(c) for b, c in zip(channels_b, channels_c))
        b, c = flatten(channels_b), flatten(channels_c)
        delta = 20 * math.log10(rms(c) / rms(b))
        error = max(abs(y - x * 10 ** (-3 / 20)) for x, y in zip(b, c))
        assert abs(delta + 3) <= gates['level_db'] and error <= gates['gain_max_sample_error']
        report = {'task_success': True, 'rms_delta_db': delta, 'gain_max_sample_error': error}
    return {'schema_version': 1, 'family': family, 'expected': expected,
            'provenance': 'fault-injected', 'request_id': trace['request_id'], 'report': report}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--trace', type=Path, required=True)
    parser.add_argument('--family', choices=['level', 'compression'], required=True)
    parser.add_argument('--expected', choices=['pass', 'objective-miss'], default='pass')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = grade(args.trace, args.family, args.expected)
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps({'family': args.family, 'expected': args.expected,
                      'task_success': result['report']['task_success']}))
