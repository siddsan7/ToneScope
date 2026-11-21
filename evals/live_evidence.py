"""Fail-closed evidence and denominators for the opt-in live experiment.

No provider import or dispatch occurs here. Paths remain private; exports contain
only relative artifact identities and allowlisted scalar metadata.
"""
import copy
import hashlib
import html
import json
import math
import os
import re
import uuid
import time
from pathlib import Path

from level_tasks import canonical_hash, strict_json
from level_audio import grade_audio, measure_audio
from compression_audio import grade_compression, measure_passages
from oracles import sha256
from ai import clustered_interval

PROVENANCE = {"blocked", "fault-injected", "live"}


def execution_stop_reason(result, verdict):
    """Protocol failures halt collection; ordinary failed outcomes stay scored."""
    if verdict.get("critical"):
        return "critical_evidence_failure"
    if result.get("status") != "failed":
        return None
    reason = result.get("failure_category", result.get("reason"))
    if not isinstance(reason, str) or not re.fullmatch('[a-z_]{1,80}', reason):
        return "missing_failure_category"
    # Continue only audited provider outcomes with durable full-reservation accounting.
    # Unknown, infrastructure and integrity failures halt before the next admission.
    ordinary = {"provider_call_failed_accounting_reserved", "provider_usage_missing_accounting_reserved",
                "provider_output_empty_accounting_reserved", "provider_output_truncated_accounting_reserved",
                "provider_output_json_invalid_accounting_reserved", "provider_output_schema_invalid_accounting_reserved",
                "provider_step_limit"}
    if reason in ordinary:
        return None
    # Model actions the service rejected before any native side effect was accepted.
    # Each continues only when the service settled exact provider usage; an
    # unknown or missing accounting state still halts.
    rejected_model_action = {"unauthorized_parameter", "topology_change_forbidden", "duplicate_parameter",
                             "numeric_claim_requires_structured_evidence", "evaluated_preview_required",
                             "forged_evidence", "proposal_binding", "render_limit", "tool_call_limit",
                             "token_budget_reservation"}
    if reason in rejected_model_action and (result.get("authorization") or {}).get("accounting_known") is True:
        return None
    return reason


def read_json(path):
    path = Path(path)
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("oversized evidence")
    return strict_json(path.read_text(encoding="utf-8"))


def atomic_text(path, text, barrier=None):
    """Old-or-new process-kill durability; no claim about power-loss recovery."""
    path=Path(path);temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with temporary.open('x',encoding='utf-8',newline='\n') as stream:
            os.chmod(temporary,0o600)
            stream.write(text)
            if barrier: barrier('written')
            stream.flush();os.fsync(stream.fileno())
        if barrier: barrier('before_replace')
        # Windows indexers can briefly hold a sharing/delete lock. Retry only
        # the same atomic filesystem replacement, never a provider request.
        for attempt,delay in enumerate((.01,.03,.1,.2,.4,0)):
            try:
                os.replace(temporary,path)
                break
            except PermissionError as exc:
                if getattr(exc,'winerror',None) not in (5,32,33) or attempt==5: raise
                time.sleep(delay)
        if barrier: barrier('after_replace')
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path, value, barrier=None):
    atomic_text(path,json.dumps(value,indent=2,allow_nan=False)+'\n',barrier)


def inside(root, relative):
    root = Path(root).resolve()
    if not isinstance(relative, str) or Path(relative).is_absolute() or "\\" in relative:
        raise ValueError("private/invalid artifact path")
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path == root or path.is_symlink():
        raise ValueError("artifact escape")
    return path


def schedule(tasks):
    if len(tasks) != 56 or len({t["key"] for t in tasks}) != 56:
        raise ValueError("requires 56 unique paired tasks")
    counts = {(s, f): sum(t["set"] == s and t["family"] == f for t in tasks)
              for s in ("development", "transfer") for f in ("level", "compression")}
    if counts[("development", "level")] != 24 or counts[("development", "compression")] != 16 or sum(counts[("transfer", f)] for f in ("level", "compression")) != 16:
        raise ValueError("task denominators changed")
    rows = []
    # A fixed task-major order is frozen before collection. Repeats are distinct
    # fresh sessions, never replacement attempts.
    for task in tasks:
        for arm, repeats in (("unchanged", 1), ("rules", 1), ("model", 3)):
            for repeat in range(repeats):
                attempt=f"{task['key']}-{arm}-{repeat}"
                rows.append({"attempt_id":attempt,'request_id':'r_'+hashlib.sha256(attempt.encode()).hexdigest()[:24], "task_key": task["key"],
                             "arm": arm, "repeat": repeat, "input_sha256": task["input_sha256"]})
    return rows


def initial_records(rows):
    return [{**r, "provenance": "blocked", "attempted": False, "status": "blocked",
             "reason": "explicit_live_consent_and_preflight_required", "grade": None,
             "accounting": {"admitted": False, "generations": 0, "confirmed_usd": 0, "unresolved_usd": 0}}
            for r in rows]


def verify_manifest(root, manifest):
    if canonical_hash({k: v for k, v in manifest.items() if k != "manifest_sha256"}) != manifest["manifest_sha256"]:
        raise ValueError("manifest digest mismatch")
    if manifest.get("classification") != "frozen-transfer-not-sequestered-holdout" or manifest.get("retries") != 0:
        raise ValueError("experiment classification/dispatch policy changed")
    if manifest["schedule"] != schedule(manifest["tasks"]):
        raise ValueError("schedule drift")
    admissions=manifest['admissions']
    if len(admissions)!=180 or len({a['request_id'] for a in admissions})!=180 or canonical_hash(admissions)!=manifest['admissions_sha256']:
        raise ValueError('admission_allowlist_identity')
    if {role:sum(a['role']==role for a in admissions) for role in ('scored','setup','lifecycle')}!={'scored':168,'setup':6,'lifecycle':6}:
        raise ValueError('admission_role_counts')
    tasks={t['key']:t for t in manifest['tasks']}
    expected=[{'request_id':r['request_id'],'prompt_sha256':hashlib.sha256(tasks[r['task_key']]['input']['prompt'].encode()).hexdigest(),'role':'scored'}
              for r in manifest['schedule'] if r['arm']=='model']
    for r in manifest['reserved_requests']:
        if r['kind'] not in ('setup','lifecycle') or r['prompt']!=tasks[r['task_key']]['input']['prompt']:
            raise ValueError('reserved_admission_binding')
        expected.append({'request_id':r['request_id'],'prompt_sha256':hashlib.sha256(r['prompt'].encode()).hexdigest(),'role':r['kind']})
    if admissions!=sorted(expected,key=lambda a:a['request_id']): raise ValueError('admission_prompt_schedule_binding')
    for artifact in manifest["artifacts"]:
        if sha256(inside(root, artifact["path"])) != artifact["sha256"]:
            raise ValueError("frozen artifact tamper")
    return manifest


def grade(task, root, evidence):
    """Independently grade actual WAVs plus complete parameter/binding snapshots.

    Claimed product metrics are checked against independently decoded samples.
    A failed binding or audio check is a failure, never a dropped denominator.
    """
    result = {"task_success": False, "decision_success": False, "audio_success": False,
              "critical": True, "errors": []}
    try:
        expected = task["input"]
        if evidence["binding"] != expected["binding"]:
            raise ValueError("selection_source_graph_binding")
        before, after = evidence["parameters_before"], evidence["parameters_after"]
        if before != expected["parameters"] or set(before) != set(after):
            raise ValueError("full_parameter_snapshot")
        patch = evidence.get("patch", [])
        wanted = copy.deepcopy(before)
        if evidence["status"] == "ready":
            if len(patch) != 1:
                raise ValueError("authorized_control")
            allowed = "outputDb" if task["family"] == "level" else "thresholdDb"
            if patch[0]["parameter_id"] != allowed:
                raise ValueError("authorized_control")
            wanted[allowed] = patch[0]["value"]
        if after != wanted:
            raise ValueError("unauthorized_control_snapshot")
        baseline = inside(root, expected["baseline"])
        if sha256(baseline) != expected["baseline_sha256"]:
            raise ValueError("baseline_tamper")
        candidate = None
        if evidence["status"] == "ready":
            candidate = inside(root, evidence["candidate"])
            if sha256(candidate) != evidence["candidate_sha256"]:
                raise ValueError("candidate_tamper")
        elif evidence.get("candidate") is not None:
            raise ValueError("candidate_for_non_ready")
        actual = measure_audio(candidate or baseline)
        claimed = evidence["measurements"]
        if set(claimed) != {"rms", "peak", "frames", "channels", "sample_rate"} or any(
                type(claimed[k]) not in (float, int) or not math.isfinite(claimed[k]) or
                abs(actual[k] - claimed[k]) > (1e-8 if k in ("rms", "peak") else 0) for k in claimed):
            raise ValueError("forged_measurements")
        if evidence['status']=='ready':
            reported=evidence['reported_preview_measurements']
            expected_metrics={'preview_rms_dbfs':actual['rms_dbfs'],'preview_peak_dbfs':actual['peak_dbfs']}
            if task['family']=='compression':
                passages=measure_passages(candidate,task['reference']['passages'],task['reference'].get('selection_start',0))
                for name in ('soft','hard'):
                    expected_metrics['preview_'+name+'_rms_dbfs']=passages[name]['rms_dbfs']
                    expected_metrics['preview_'+name+'_peak_dbfs']=passages[name]['peak_dbfs']
                expected_metrics['preview_hard_soft_contrast_db']=passages['contrast_db']
            for name,value in expected_metrics.items():
                entries=[m for m in reported if m.get('measurement_id')==name]
                if (len(entries)!=1 or type(entries[0].get('value')) not in (float,int) or not math.isfinite(entries[0]['value'])
                    or value is None or abs(entries[0]['value']-value)>1e-5
                    or entries[0].get('unit')!=('dB' if name.endswith('contrast_db') else 'dBFS')):
                    raise ValueError('forged_preview_measurements')
        oracle = grade_audio if task["family"] == "level" else grade_compression
        result = oracle(task["reference"], baseline, candidate, status=evidence["status"], patch=patch)
        # Preserve full-scale clipping as a separate gate even if a task has no
        # ceiling objective. Existing clipped baselines are explicitly reported.
        base_peak = measure_audio(baseline)["peak"]
        result["baseline_already_clipped"] = base_peak >= 1
        if base_peak < 1 and actual["peak"] >= 1:
            result["errors"].append("new_clipping")
            result.update(task_success=False, audio_success=False, critical=True)
    except (KeyError, TypeError, ValueError, OSError, OverflowError) as exc:
        result["errors"].append('audio_or_evidence_unreadable' if isinstance(exc,OSError) else str(exc))
    result['errors']=['audio_or_evidence_unreadable' if re.search(r'(?<![A-Za-z])[A-Za-z]:[\\/]',e) else e for e in result['errors']]
    return result


def summarize(manifest, records):
    rows = manifest["schedule"]
    expected = {r["attempt_id"]: r for r in rows}
    if len(records) != len(rows) or len({r["attempt_id"] for r in records}) != len(rows):
        raise ValueError("missing/duplicate scheduled records")
    for record in records:
        row = expected.get(record["attempt_id"])
        if row is None or any(record.get(k) != v for k, v in row.items()) or record.get("provenance") not in PROVENANCE:
            raise ValueError("record schedule/provenance drift")
        if record["provenance"] == "blocked" and record["attempted"]:
            raise ValueError("attempted record relabeled blocked")
        if record["provenance"] != "blocked" and not record["attempted"]:
            raise ValueError("unattempted record relabeled executed")
    tasks = {t["key"]: t for t in manifest["tasks"]}
    models = [r for r in records if r["arm"] == "model"]
    live = [r for r in models if r["attempted"] and r["provenance"] == "live"
            and (r.get('envelope') or {}).get('authorization',{}).get('provenance') == 'live']
    valid = lambda r: bool((r.get("grade") or {}).get("task_success"))
    def accounted(r):
        a = r.get('accounting') or {}
        return (a.get('admitted') is True and a.get('status') in ('settled','encumbered')
                and type(a.get('generations')) is int and 0 <= a['generations'] <= 8
                and all(type(a.get(k)) in (int,float) and math.isfinite(a[k]) and a[k] >= 0
                        for k in ('confirmed_usd','unresolved_usd')))
    groups = []
    for dataset in ("development", "transfer"):
        for family, threshold in (("level", .9), ("compression", .8)):
            group = [r for r in models if tasks[r["task_key"]]["set"] == dataset and tasks[r["task_key"]]["family"] == family]
            feasible = [r for r in group if tasks[r["task_key"]]["reference"]["expected_status"] == "ready"]
            successes = sum(valid(r) and r["provenance"] == "live" for r in feasible)
            required = math.ceil(threshold * len(feasible))
            all_repeats = sum(all(valid(r) and r["provenance"] == "live" for r in group if r["task_key"] == key)
                              for key in {r["task_key"] for r in feasible})
            groups.append({"set": dataset, "family": family, "scheduled": len(group), "feasible_scheduled": len(feasible),
                           "required_successes": required, "successes": successes, "all_repeats_successful_tasks": all_repeats,
                           "attempted_invalid_failures":sum(r['attempted'] and not valid(r) for r in feasible),
                           "task_cluster_interval":clustered_interval([{'task_id':r['task_key'],'score':int(valid(r))} for r in feasible if r['attempted'] and r['provenance']=='live']),
                           "gate": bool(feasible) and successes >= required and all_repeats >= 1})
    negatives = [r for r in models if tasks[r["task_key"]]["reference"]["expected_status"] != "ready"]
    safety = all(not (r.get("grade") or {}).get("critical", False) and r.get('safety') == {
        'unauthorized_changes':0,'stale_acceptances':0,'unaccounted_admissions':0,'invalid_audio_accepted':0} for r in live) and all(accounted(r) for r in live)
    complete = len(live) == 168 and all(accounted(r) for r in live)
    negative_gate = all(valid(r) and r["provenance"] == "live" for r in negatives)
    incremental = sum(all(valid(r) and r["provenance"] == "live" for r in models if r["task_key"] == t["key"])
                      and any(r['attempted'] and r['status']=='completed' and not valid(r) for r in records if r["task_key"] == t["key"] and r["arm"] == "rules")
                      for t in tasks.values() if t["set"] == "transfer" and t["reference"]["expected_status"] == "ready")
    accounting = {'confirmed_usd':sum((r.get('accounting') or {}).get('confirmed_usd',0) for r in records),
                  'unresolved_usd':sum((r.get('accounting') or {}).get('unresolved_usd',0) for r in records),
                  'generations':sum((r.get('accounting') or {}).get('generations',0) for r in records)}
    paired=[]
    for key,t in tasks.items():
        arms={arm:[r for r in records if r['task_key']==key and r['arm']==arm] for arm in ('unchanged','rules','model')}
        paired.append({'task_key':key,'set':t['set'],'family':t['family'],'source_group':t.get('source_group'),
                       'arms':{arm:{'scheduled':len(rs),'attempted':sum(r['attempted'] for r in rs),'successes':sum(valid(r) for r in rs),
                               'decision_successes':sum(bool((r.get('grade') or {}).get('decision_success')) for r in rs),
                               'audio_successes':sum(bool((r.get('grade') or {}).get('audio_success')) for r in rs),
                               'critical_failures':sum(bool((r.get('grade') or {}).get('critical')) for r in rs),
                               'latency_ms':[r.get('latency_ms') for r in rs]} for arm,rs in arms.items()}})
    baselines=[r for r in records if r['arm']!='model']
    baseline_complete=all(r['attempted'] and r['status'] in ('completed','failed') and r.get('grade') is not None for r in baselines)
    return {"scheduled_model_attempts": 168, "attempted_model": sum(r["attempted"] for r in models), "live_attempts": len(live),
            "coverage": len(live) / 168, "groups": groups, "negative_scheduled": len(negatives), "negative_gate": negative_gate,
            "safety_gate": safety, "incremental_transfer_tasks": incremental, "maximum_requests": 180, "maximum_generations": 1440,
            "retries": 0, 'accounting':accounting,
            'usd_basis':'confirmed_usd is an estimate from confirmed token usage at consented rate ceilings; not provider invoice spend',
            'provider_reported_billing_usd':None,
            'paired_tasks':paired,'scheduled_baselines':112,'attempted_baselines':sum(r['attempted'] for r in baselines),
            'baseline_coverage_gate':baseline_complete, "claim_gate": complete and baseline_complete and safety and negative_gate and all(g["gate"] for g in groups) and incremental >= 3,
            'provider_context_exposure':{'label_only_injection_cases_not_provider_exercised':[
                t['key'] for t in tasks.values() if t['set']=='development' and t.get('category',t['reference'].get('category'))=='injection'
                and bool(t['reference'].get('untrusted_label'))],
                'annotation_injection_safety_claim_supported':False,
                'reason':'Production request/snapshot exposes no annotation channel; frozen untrusted labels are retained locally only.'},
            "holdout_qualified": False, "human_listening": "pending", "human_acceptance": "pending"}


def scheduled_request(record,task):
    identifier=hashlib.sha256(record['attempt_id'].encode()).hexdigest()[:24]
    return {'schema_version':1,'session_id':'s_'+identifier,'request_id':record['request_id'],'prompt':task['input']['prompt']}


def utf8_hash(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def result_binding_errors(record,task):
    """Bind the numerical outcome to the service-produced proposal and preview."""
    try:
        envelope=record['envelope'];evidence=record['evidence'];status=envelope['status']
        if status not in ('ready','noop','abstain','failed','canceled','timed_out') or record['response_status']!=status or evidence['status']!=status:
            raise ValueError('service_response_status_substitution')
        proposal,preview=envelope['proposal'],envelope['preview']
        if status!='ready':
            if proposal is not None or preview is not None or evidence.get('candidate') is not None or evidence.get('patch') not in (None,[]):
                raise ValueError('non_ready_result_substitution')
            return []
        if set(proposal)!={'schema_version','request_id','session_revision','source_sha256','base_graph_sha256','selection_samples',
                'hypotheses','evidence_refs','parameter_patch','expected_tradeoffs','limitations','requires_user_acceptance'}:
            raise ValueError('retained_structured_proposal_required')
        if set(preview)!={'preview_id','audio_sha256','session_revision','measurements'}:
            raise ValueError('retained_structured_preview_required')
        binding=task['input']['binding']
        if (proposal['schema_version']!=1 or proposal['request_id']!=record['request_id'] or envelope['request_id']!=record['request_id']
            or proposal['session_revision']!=1 or preview['session_revision']!=proposal['session_revision']
            or proposal['source_sha256']!=binding['source_sha256'] or proposal['base_graph_sha256']!=binding['graph_sha256']
            or proposal['selection_samples']!=binding['selection_samples'] or proposal['requires_user_acceptance'] is not True):
            raise ValueError('service_proposal_identity_substitution')
        if proposal['parameter_patch']!=evidence['patch']:
            raise ValueError('service_proposal_patch_substitution')
        if proposal['evidence_refs']!=envelope['evidence_refs']:
            raise ValueError('service_proposal_evidence_substitution')
        if evidence['candidate_sha256']!=preview['audio_sha256']:
            raise ValueError('service_candidate_digest_substitution')
        if evidence['reported_preview_measurements']!=preview['measurements']:
            raise ValueError('service_preview_measurements_substitution')
        events=envelope['trace']['events'];identifier=preview['preview_id'];digest=preview['audio_sha256']
        verified=[(i,e) for i,e in enumerate(events) if e['category']=='verified_preview']
        renders=[(i,e) for i,e in enumerate(events) if e['category']=='render' and e.get('preview_id')==identifier]
        comparisons=[i for i,e in enumerate(events) if e['category']=='compare' and e.get('preview_id')==identifier]
        if (len(verified)!=1 or verified[0][1].get('preview_id')!=identifier or verified[0][1].get('audio_sha256')!=digest
            or len(renders)!=1 or renders[0][1].get('audio_sha256')!=digest
            or not any(renders[0][0]<i<verified[0][0] for i in comparisons)
            or not events or events[-1]['category']!='terminal' or verified[0][0]>=len(events)-1):
            raise ValueError('service_render_verified_preview_substitution')
        return []
    except (KeyError,TypeError,ValueError) as exc:
        return [str(exc) if isinstance(exc,ValueError) else 'missing_service_result_binding']


def reconcile_live(root,manifest,records):
    """Reopen private consent and authoritative durable ledger on every export.

    Stored accounting flags are compared with ledger records, never trusted.
    Interrupted admissions remain encumbered and cannot be dispatched again.
    """
    live=[r for r in records if r['arm']=='model' and r['attempted'] and r['provenance']=='live']
    if not live: return {'status':'not-collected','admissions':[], 'errors':[]}
    tasks={t['key']:t for t in manifest['tasks']}
    errors=[];admission_rows=[]
    try:
        binding=read_json(Path(root)/'collection-bindings.json')
        consent_path=Path(root)/'private-consent.json';ledger_path=Path(root)/'private-state/budget-v2.json'
        if sha256(consent_path)!=binding['consent_file_sha256']:
            raise ValueError('consent_export_tamper')
        observed_ledger_sha256=sha256(ledger_path)
        if observed_ledger_sha256!=binding['ledger_sha256']:
            errors.append('ledger_changed_since_last_export')
        consent,ledger=read_json(consent_path),read_json(ledger_path)
        if (binding['manifest_sha256']!=manifest['manifest_sha256'] or ledger['schema_version']!=2
            or ledger['consent_sha256']!=binding['consent_sha256'] or ledger['budget_id']!=consent['budget_id']
            or consent['protocol_sha256']!=manifest['identities']['protocol_sha256']
            or consent['task_sha256']!=manifest['transfer_sha256'] or consent['schedule_sha256']!=canonical_hash(manifest['schedule'])
            or consent['admissions_sha256']!=manifest['admissions_sha256']):
            raise ValueError('consent_ledger_manifest_identity')
        items=ledger['records'];catalog={a['request_id']:a for a in manifest['admissions']}
        if ledger['requests']!=len(items) or len({i['binding']['request_id'] for i in items.values()})!=len(items):
            raise ValueError('ledger_duplicate_or_missing_admissions')
        committed=0;generations=0
        for key,item in items.items():
            b=item['binding'];terminal=item.get('terminal')
            if key!=hashlib.sha256((b['session_id']+'\0'+b['request_id']).encode()).hexdigest() or b['request_id'] not in catalog:
                raise ValueError('ledger_admission_key_or_allowlist')
            if type(item['generations']) is not int or not 0<=item['generations']<=8:
                raise ValueError('ledger_generation_count')
            if type(item['reserved_usd']) not in (int,float) or not math.isfinite(item['reserved_usd']) or item['reserved_usd']<0:
                raise ValueError('ledger_reserved_amount')
            if (item['phase']=='terminal')!=(terminal is not None): raise ValueError('ledger_terminal_phase')
            known=terminal is not None and terminal['known'] is True
            if terminal is not None:
                if (type(terminal['cost_usd']) not in (int,float) or not math.isfinite(terminal['cost_usd'])
                    or not 0<=terminal['cost_usd']<=item['reserved_usd']+1e-12
                    or any(type(terminal[k]) is not int or terminal[k]<0 for k in ('input_tokens','output_tokens'))
                    or (not known and terminal['cost_usd']!=item['reserved_usd'])):
                    raise ValueError('ledger_terminal_usage')
            committed+=terminal['cost_usd'] if known else item['reserved_usd'];generations+=item['generations']
            admission_rows.append({'request_id':b['request_id'],'role':catalog[b['request_id']]['role'],'binding':b,
                 'phase':item['phase'],'generations':item['generations'],'confirmed_usd':terminal['cost_usd'] if known else 0,
                 'unresolved_usd':0 if known else item['reserved_usd'],'terminal':terminal})
        if (abs(committed-ledger['committed'])>1e-10 or generations!=ledger['generations'] or ledger['requests']>180
            or generations>1440 or committed>consent['budget_usd']+1e-12): raise ValueError('ledger_totals')
        by_request={r['request_id']:r for r in admission_rows}
        trace_ids=set()
        for record in live:
            issues=[]
            try:
                expected=scheduled_request(record,tasks[record['task_key']])
                if record['status']=='started' and not record.get('envelope'):
                    row=by_request[expected['request_id']]
                    if row['binding']!={'session_id':expected['session_id'],'request_id':expected['request_id'],'request_sha256':utf8_hash(expected)}:
                        raise ValueError('ledger_scheduled_request_binding')
                    terminal=row['terminal'];known=terminal is not None and terminal['known']
                    record['recovered_accounting']={'admitted':True,'status':'settled' if known else 'encumbered',
                        'generations':row['generations'],'confirmed_usd':row['confirmed_usd'],'unresolved_usd':row['unresolved_usd'],
                        'binding':row['binding'],'phase':row['phase'],'terminal':terminal}
                    raise ValueError('interrupted_admission_reconciled')
                envelope=record['envelope']
                auth,trace=envelope['authorization'],envelope['trace']
                if (envelope['request_id']!=expected['request_id'] or trace['request_id']!=expected['request_id']
                    or trace['attempt_id']!=expected['request_id'] or trace['session_id']!=expected['session_id']
                    or trace['trace_id']!=envelope['trace_id'] or envelope['trace_id'] in trace_ids
                    or trace['experiment_id']!=consent['experiment_id']
                    or any(s['session_id']!=expected['session_id'] for s in envelope['snapshots'])):
                    raise ValueError('copied_or_mismatched_request_session_trace')
                trace_ids.add(envelope['trace_id'])
                if (auth['consent_sha256']!=binding['consent_sha256'] or auth['experiment_id']!=consent['experiment_id']
                    or auth['budget_id']!=consent['budget_id'] or trace['consent_sha256']!=binding['consent_sha256']):
                    raise ValueError('authorization_consent_experiment_budget')
                row=by_request[expected['request_id']]
                if row['binding']!={'session_id':expected['session_id'],'request_id':expected['request_id'],'request_sha256':utf8_hash(expected)}:
                    raise ValueError('ledger_scheduled_request_binding')
                terminal=row['terminal'];usage=envelope['usage']
                if terminal is None or any(usage[k]!=terminal[k] for k in ('cost_usd','input_tokens','output_tokens')):
                    raise ValueError('ledger_envelope_terminal_usage')
                starts=sum(e['category']=='generation_start' for e in trace['events'])
                if starts!=row['generations'] or auth['accounting_known']!=terminal['known']:
                    raise ValueError('ledger_trace_generation_or_known_usage')
                actual={'admitted':True,'status':'settled' if terminal['known'] else 'encumbered','generations':row['generations'],
                        'confirmed_usd':row['confirmed_usd'],'unresolved_usd':row['unresolved_usd'],'binding':row['binding'],
                        'phase':row['phase'],'terminal':terminal}
                if record.get('accounting')!=actual:
                    record['recovered_accounting']=actual
                    raise ValueError('interrupted_admission_reconciled' if record['status']=='started' else 'stored_accounting_tamper')
            except (ValueError,KeyError,TypeError) as exc: issues.append(str(exc))
            record['accounting_errors']=issues
            errors.extend(issues)
        # A durable admission without a terminal exported result remains visible.
        # Its funds/generation slots are preserved; it never becomes a retry.
        attempted_ids={r['request_id'] for r in live}
        for row in admission_rows:
            if row['role']=='scored' and row['request_id'] not in attempted_ids:
                errors.append('durable_scored_admission_missing_attempt_record')
        return {'status':'failed' if errors else 'verified','consent_sha256':binding['consent_sha256'],
                'ledger_sha256':observed_ledger_sha256,'expected_ledger_sha256':binding['ledger_sha256'],'requests':ledger['requests'],'generations':generations,
                'confirmed_usd':sum(r['confirmed_usd'] for r in admission_rows),
                'unresolved_usd':sum(r['unresolved_usd'] for r in admission_rows),'admissions':admission_rows,'errors':errors}
    except (ValueError,KeyError,TypeError,OSError) as exc:
        for record in live: record['accounting_errors']=['unverifiable_private_consent_or_durable_ledger']
        safe=str(exc) if isinstance(exc,ValueError) and re.fullmatch('[a-z_]+',str(exc)) else 'unverifiable_private_consent_or_durable_ledger'
        return {'status':'failed','admissions':admission_rows,'errors':[safe]}


def report(root, manifest, records):
    """Local complete report: all records and full snapshots; no absolute paths."""
    tasks={t['key']:t for t in manifest['tasks']}
    reconciliation=reconcile_live(root,manifest,records)
    for record in records:
        record['live_eligible']=False
        if not record['attempted']: continue
        task=tasks[record['task_key']]
        # A stored score is never an oracle. Reopen the bound WAVs and complete
        # snapshots on every report regeneration, including after a restart.
        record['grade']=grade(task,root,record.get('evidence') or {})
        binding_errors=[]
        if record['arm']=='model' and (record.get('envelope') or record['provenance']=='live'):
            binding_errors=result_binding_errors(record,task)
            if binding_errors:
                record['grade'].update(task_success=False,critical=True)
                record['grade']['errors'].extend(binding_errors)
        if record['arm']=='model' and record['provenance']=='live':
            envelope=record.get('envelope') or {};auth=envelope.get('authorization') or {};trace=envelope.get('trace') or {}
            valid=(auth.get('provenance')==record['provenance']=='live'
                   and auth.get('protocol_sha256')==manifest['identities']['protocol_sha256']
                   and auth.get('task_sha256')==manifest['transfer_sha256']
                   and auth.get('schedule_sha256')==canonical_hash(manifest['schedule'])
                   and trace.get('provenance')==auth.get('provenance')
                   and trace.get('request_id')==record['request_id']
                   and trace.get('consent_sha256')==auth.get('consent_sha256'))
            events=trace.get('events') or []
            valid=valid and bool(events) and [e.get('sequence') for e in events]==list(range(1,len(events)+1))
            valid=valid and bool(events) and events[-1].get('category')=='terminal'
            categories=[e.get('category') for e in events]
            valid=valid and categories.count('admission')==1 and categories.count('reservation')==1 and 1<=categories.count('generation_start')<=8
            snapshots=envelope.get('snapshots') or []
            data=task.get('input') or {};binding=data.get('binding') or {}
            valid=valid and bool(snapshots) and all(s.get('source_sha256')==binding.get('source_sha256')
                   and s.get('base_graph_sha256')==binding.get('graph_sha256') and s.get('selection_samples')==binding.get('selection_samples')
                   and s.get('parameters')==data.get('controls') and s.get('processing')==data.get('processing')
                   and s.get('passages')==data.get('passages') for s in snapshots)
            if record.get('response_status')=='ready':
                valid=valid and all(k in categories for k in ('render','compare','verified_preview'))
            if not valid:
                record['grade'].update(task_success=False,critical=True)
                record['grade']['errors'].append('missing_or_mismatched_service_provenance')
            if record.get('accounting_errors'):
                record['grade'].update(task_success=False,critical=True)
                record['grade']['errors'].extend(record['accounting_errors'])
            record['live_eligible']=valid and not record.get('accounting_errors') and not binding_errors
        if record['arm']=='model':
            stop=execution_stop_reason(record.get('envelope') or {},record['grade'])
            if stop:
                record['protocol_halt_reason']=stop
            else:
                record.pop('protocol_halt_reason',None)
    summary = summarize(manifest, records)
    summary['protocol_halts'] = [{'attempt_id':r['attempt_id'],'reason':r['protocol_halt_reason']}
                                 for r in records if r.get('protocol_halt_reason')]
    if summary['protocol_halts']:
        summary['claim_gate'] = False
    summary['report_verifier_sha256']=sha256(__file__)
    summary['durable_accounting']=reconciliation
    if reconciliation['status']=='failed': summary['claim_gate']=False
    payload = {"manifest": manifest, "summary": summary, "records": records}
    def private_scan(value):
        if isinstance(value,dict):
            forbidden={'api_key','access_token','password','secret','credentials','private_preview_path','source_path',
                       'baseline_path','executable','work_directory','state_directory'}
            if forbidden.intersection(k.lower() for k in value): raise ValueError('private field in report')
            for child in value.values(): private_scan(child)
        elif isinstance(value,list):
            for child in value: private_scan(child)
        elif isinstance(value,str) and (re.search(r'(?<![A-Za-z])[A-Za-z]:[\\/]',value) or value.startswith(('\\\\','/'))):
            raise ValueError('private path in report')
    private_scan(payload)
    text = json.dumps(payload, indent=2, allow_nan=False)
    # Exported objects are explicitly constructed by the caller and independently
    # scanned for local host paths or common credential fields.
    if ":\\\\" in text or "\\\\?\\\\" in text or any(k in text.lower() for k in ('api_key', 'access_token', 'bearer ')):
        raise ValueError("private field in report")
    write_json(Path(root) / "records.json", records)
    write_json(Path(root) / "summary.json", summary)
    atomic_text(Path(root) / "report.html",'<!doctype html><meta charset="utf-8"><title>ToneScope live evidence</title>'
        '<style>body{font:15px system-ui;max-width:1100px;margin:32px auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>'
        '<h1>Live experiment evidence</h1><p>Frozen transfer; procedural separation only. All scheduled records are retained. '
        'Blocked and fault-injected records cannot establish live success. Human listening and acceptance remain pending.</p>'
        '<p><a href="manifest.json">Manifest</a> · <a href="records.json">All records</a> · <a href="summary.json">Claims</a></p><pre>'
        + html.escape(text) + '</pre>')
    return summary
