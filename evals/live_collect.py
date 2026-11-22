"""Separate opt-in collector. No imports from provider SDKs; zero retry policy.

Default mode checks a frozen manifest and writes a blocked report. Offline paired
baselines require --offline-baselines. Spending requires the explicit live flag,
private validated consent, exact P4 preflight and the production service runner.
"""
import argparse
import copy
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

from level_tasks import ROOT, canonical_hash, strict_json
from live_evidence import read_json, write_json, verify_manifest, inside, grade, report, result_binding_errors, execution_stop_reason
from live_freeze import render, runtime_identity
from level_audio import measure_audio
from oracles import sha256
from provenance import source_identity


def adapter_identity(runtime):
    return runtime_identity(runtime)


def request_digest(request):
    # Request contains only strings and integer schema_version. Match the
    # production UTF-8 canonicalizer; policy decimals are handled by Node below.
    return hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def retained_envelope(result):
    """Keep structured service evidence; never export generated free prose."""
    retained={k:copy.deepcopy(result[k]) for k in ('authorization','trace','snapshots','usage','status','request_id','trace_id','evidence_refs','proposal','preview')}
    if result['status']=='failed':
        reason=result.get('reason')
        retained['failure_category']=reason if isinstance(reason,str) and re.fullmatch('[a-z_]{1,80}',reason) else None
    if retained['proposal'] is not None:
        for field in ('hypotheses','expected_tradeoffs','limitations'): retained['proposal'][field]=['redacted']
    return retained


DIAGNOSTIC_COUNTS=('generation','byte_length','top_level_json_values','trailing_unparsed_bytes')
DIAGNOSTIC_FLAGS=('starts_with_brace','ends_with_brace','has_code_fence')


def retained_output_diagnostic(diagnostic, request, result):
    """Closed, content-free shape facts for a JSON/schema-rejected model output.

    The production collector emits this beside the envelope so native and
    history envelope validators stay unchanged. Anything outside the closed
    shape is treated as an evidence integrity failure, never retained.
    """
    if set(diagnostic) != {'schema_version','request_id','category','finish_reason','schema_issues',*DIAGNOSTIC_COUNTS,*DIAGNOSTIC_FLAGS}:
        raise ValueError('provider_output_diagnostic_fields')
    category=diagnostic['category']
    if (diagnostic['schema_version'] != 1 or diagnostic['request_id'] != request['request_id']
            or category not in ('json_invalid','schema_invalid')
            or result.get('status') != 'failed' or result.get('reason') != f'provider_output_{category}_accounting_reserved'
            or not isinstance(diagnostic['finish_reason'],str) or not re.fullmatch('[a-z_-]{1,20}',diagnostic['finish_reason'])
            or any(type(diagnostic[k]) is not int or diagnostic[k] < 0 for k in DIAGNOSTIC_COUNTS)
            or not 1 <= diagnostic['generation'] <= 8
            or any(type(diagnostic[k]) is not bool for k in DIAGNOSTIC_FLAGS)):
        raise ValueError('provider_output_diagnostic_binding')
    issues=diagnostic['schema_issues']
    if (not isinstance(issues,list) or len(issues) > 16 or (category == 'json_invalid' and issues)
            or any(not isinstance(i,dict) or set(i) != {'path','code'} or not isinstance(i['code'],str)
                   or not re.fullmatch('[a-z_]{1,40}',i['code']) or not isinstance(i['path'],list) or len(i['path']) > 8
                   or any(not (type(p) is int and p >= 0) and not (isinstance(p,str) and re.fullmatch('[a-z0-9_]{1,40}|[?]',p))
                          for p in i['path']) for i in issues)):
        raise ValueError('provider_output_diagnostic_issues')
    return copy.deepcopy(diagnostic)


def retained_stall_diagnostic(stdout, request):
    """Closed, content-free facts from a collector process that outlived its wall limit.

    Only the final stdout line is read. Anything outside the closed shape, or
    bound to another request, is dropped; the attempt fails either way.
    """
    try:
        output=strict_json(stdout.strip().splitlines()[-1])
        diagnostic=output['collector_stall_diagnostic']
        if (set(output) != {'schema_version','request_sha256','collector_stall_diagnostic'} or output['schema_version'] != 1
                or output['request_sha256'] != request_digest(request)
                or set(diagnostic) != {'schema_version','request_id','elapsed_ms','ledger_step','output_written','active_resources'}
                or diagnostic['schema_version'] != 1 or diagnostic['request_id'] != request['request_id']
                or type(diagnostic['elapsed_ms']) is not int or not 0 <= diagnostic['elapsed_ms'] <= 600000
                or not isinstance(diagnostic['ledger_step'],str) or not re.fullmatch('[a-z_]{1,40}',diagnostic['ledger_step'])
                or type(diagnostic['output_written']) is not bool):
            return None
        resources=diagnostic['active_resources']
        if (not isinstance(resources,dict) or len(resources) > 32
                or any(not isinstance(k,str) or not re.fullmatch('[A-Za-z]{1,40}',k) or type(v) is not int or not 0 <= v <= 10000
                       for k,v in resources.items())):
            return None
        return copy.deepcopy(diagnostic)
    except (ValueError,KeyError,TypeError,IndexError,AttributeError):
        return None


def consent_preflight(root, manifest, args):
    if not args.run_consented_experiment or not args.consent or not args.preflight:
        raise ValueError('explicit_live_opt_in_consent_and_P4_preflight_required')
    consent, gate = read_json(args.consent), read_json(args.preflight)
    if set(consent) != {'schema_version','consent','experiment_id','budget_id','protocol_sha256','task_sha256','schedule_sha256',
           'metadata_sha256','currency','budget_usd','verified_model','provider_slug','verified_at','input_usd_per_million',
           'output_usd_per_million','pricing_source','max_requests','max_generations','approved_data_classes','limits','admissions_sha256'}:
        raise ValueError('strict_consent_schema')
    if consent['schema_version'] != 1 or consent['consent'] is not True or consent['currency'] != 'USD':
        raise ValueError('concrete_consent_required')
    if consent['approved_data_classes'] != ['request_text','scalar_measurements','authorized_controls','identity_metadata']:
        raise ValueError('approved_data_classes')
    if consent['limits'] != {'tool_calls':8,'candidates':3,'render_seconds':30,'wall_ms':60000,'input_tokens':12000,'output_tokens':4000}:
        raise ValueError('consent_limit_drift')
    for k in ('budget_usd','input_usd_per_million','output_usd_per_million'):
        if type(consent[k]) not in (int,float) or not math.isfinite(consent[k]) or consent[k] < 0:
            raise ValueError('finite_budget_rates_required')
    if consent['budget_usd'] <= 0 or consent['max_requests'] != 180 or consent['max_generations'] != 1440:
        raise ValueError('full_frozen_schedule_ceiling_required')
    timestamp=datetime.datetime.fromisoformat(consent['verified_at'].replace('Z','+00:00'))
    age=(datetime.datetime.now(datetime.timezone.utc)-timestamp).total_seconds()
    if not 0 <= age <= 86400: raise ValueError('stale_price_consent')
    reserve=(12000*consent['input_usd_per_million']+4000*consent['output_usd_per_million'])/1e6
    if reserve*180 > consent['budget_usd']+1e-12: raise ValueError('full_schedule_currency_unfunded')
    for key,value in {'protocol_sha256':manifest['identities']['protocol_sha256'],'task_sha256':manifest['transfer_sha256'],
                      'schedule_sha256':canonical_hash(manifest['schedule']),'admissions_sha256':manifest['admissions_sha256']}.items():
        if consent[key] != value: raise ValueError('consent_manifest_binding')
    if consent['pricing_source'] != 'https://ai-gateway.vercel.sh/v1/models': raise ValueError('authoritative_price_source_required')
    if gate.get('stage') != 'P4' or gate.get('status') != 'passed' or gate.get('manifest_sha256') != manifest['manifest_sha256'] or not gate.get('independent_review_sha256'):
        raise ValueError('reviewed_P4_preflight_required')
    if not gate.get('checks') or any(c.get('status') != 'passed' for c in gate['checks']):
        raise ValueError('P4_checks_incomplete')
    for artifact in gate.get('artifacts',[]):
        if sha256(inside(root,artifact['path'])) != artifact['sha256']: raise ValueError('preflight_evidence_tamper')
    identities=manifest['identities']
    if (sha256(args.cli) != identities['binary_sha256'] or source_identity(ROOT) != identities['source_snapshot_sha256']
        or adapter_identity(args.runtime) != identities['adapter_prompt_sha256']
        or sha256(args.runtime/'package-lock.json') != identities['lockfile_sha256']):
        raise ValueError('current_code_runtime_or_binary_drift')
    if identities['compiled'].get('source_identity_sha256') != identities['source_snapshot_sha256']:
        raise ValueError('compiled_source_identity_stale_rebuild_and_refreeze')
    node=shutil.which(args.node)
    if not node: raise ValueError('node_required')
    checked=subprocess.run([node,'--experimental-strip-types',str(args.runtime/'agent/lib/live-collector.ts'),
                           '--preflight','--consent-file',str(args.consent.resolve())],
                          capture_output=True,text=True,timeout=15,env=safe_environment())
    if checked.returncode or len(checked.stdout)>65536: raise ValueError('production_consent_preflight_failed')
    validated=strict_json(checked.stdout)
    digest=validated['consent_sha256']
    if not isinstance(digest,str) or len(digest)!=64: raise ValueError('production_consent_digest_missing')
    return consent,digest


def snapshot(task, identifier):
    data=task['input'];binding=data['binding']
    result={'session_id':'s_'+identifier,'session_revision':1,'source_sha256':binding['source_sha256'],
            'base_graph_sha256':binding['graph_sha256'],'source_handle':'asset_'+task['key'].replace('-','_'),
            'selection_samples':binding['selection_samples'],'sample_rate':binding['sample_rate'],'parameters':data['controls']}
    if data.get('passages') is not None: result['passages']=data['passages']
    result['processing']=data['processing']
    return result


def safe_environment(live=False):
    env={k:v for k,v in os.environ.items() if k not in ('NODE_OPTIONS','NODE_PATH','TONESCOPE_ENABLE_LIVE')}
    if not live:
        for k in ('AI_GATEWAY_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY'): env.pop(k,None)
    return env


def accounting(root, request, consent, consent_sha256):
    path=Path(root)/'private-state/budget-v2.json'
    ledger=read_json(path)
    if ledger['consent_sha256'] != consent_sha256 or ledger['budget_id'] != consent['budget_id']:
        raise ValueError('ledger_identity_mismatch')
    key=hashlib.sha256((request['session_id']+'\0'+request['request_id']).encode()).hexdigest()
    item=ledger['records'][key]
    if item['binding'] != {'session_id':request['session_id'],'request_id':request['request_id'],'request_sha256':request_digest(request)}:
        raise ValueError('ledger_request_mismatch')
    terminal=item.get('terminal')
    known=terminal is not None and terminal['known']
    return {'admitted':True,'status':'settled' if known else 'encumbered','generations':item['generations'],
            'confirmed_usd':terminal['cost_usd'] if known else 0,'unresolved_usd':0 if known else item['reserved_usd'],
            'binding':item['binding'],'phase':item['phase'],'terminal':terminal}


def validate_envelope(envelope, request, snap, consent, consent_sha256):
    auth,trace=envelope['authorization'],envelope['trace']
    for key in ('experiment_id','budget_id','protocol_sha256','task_sha256','schedule_sha256'):
        if auth[key] != consent[key]: raise ValueError('authorization_binding')
    if auth['provenance'] != 'live' or auth['consent_sha256'] != consent_sha256: raise ValueError('provenance_or_consent_binding')
    if trace['provenance'] != 'live' or trace['request_id'] != request['request_id'] or trace['session_id'] != request['session_id'] or trace['consent_sha256'] != consent_sha256:
        raise ValueError('trace_binding')
    events=trace['events']
    if [e['sequence'] for e in events] != list(range(1,len(events)+1)) or not events or events[-1]['category'] != 'terminal':
        raise ValueError('trace_sequence')
    categories=[e['category'] for e in events]
    if categories.count('admission') != 1 or categories.count('reservation') != 1 or not 1 <= categories.count('generation_start') <= 8:
        raise ValueError('dispatch_trace_incomplete')
    for actual in envelope['snapshots']:
        if actual != snap: raise ValueError('snapshot_drift')
    if not envelope['snapshots']: raise ValueError('full_snapshots_required')
    for event in events:
        if 'source_sha256' in event and any(event[k] != snap[k] for k in ('source_sha256','base_graph_sha256','selection_samples','session_revision')):
            raise ValueError('trace_snapshot_binding')
    if envelope['status']=='ready' and not all(k in categories for k in ('render','compare','verified_preview')):
        raise ValueError('ready_without_verified_preview')


def evidence_from_result(root, task, folder, result, preview, cli):
    if not isinstance(result,dict) or result.get('status') not in ('ready','noop','abstain','failed','canceled','timed_out'):
        raise ValueError('missing_or_invalid_production_response')
    data=task['input'];parameters=copy.deepcopy(data['parameters'])
    patch=(result.get('proposal') or {}).get('parameter_patch',[])
    for p in patch:
        if p['parameter_id'] not in parameters: raise ValueError('unknown_parameter')
        parameters[p['parameter_id']]=p['value']
    candidate=None
    if result['status']=='ready':
        candidate=folder/'candidate.wav'
        shutil.copyfile(preview,candidate)
        if sha256(candidate) != result['preview']['audio_sha256']: raise ValueError('preview_tamper')
        # Re-render independently from the complete host-owned parameter snapshot.
        # This checks hidden controls, filter topology and complete graph identity.
        check,manifest=render(cli,inside(root,data['source']),parameters,folder,'independent-native',data['binding']['selection_samples'])
        if sha256(check) != sha256(candidate): raise ValueError('independent_native_render_mismatch')
    actual=measure_audio(candidate or inside(root,data['baseline']))
    return {'status':result['status'],'binding':data['binding'],'parameters_before':data['parameters'],'parameters_after':parameters,
            'patch':patch,'candidate':candidate.relative_to(root).as_posix() if candidate else None,
            'candidate_sha256':sha256(candidate) if candidate else None,
            'measurements':{k:actual[k] for k in ('rms','peak','frames','channels','sample_rate')},
            'reported_preview_measurements':(result.get('preview') or {}).get('measurements',[])}


def collect(args):
    root=args.experiment.resolve();manifest=verify_manifest(root,read_json(root/'manifest.json'))
    records=read_json(root/'records.json');report(root,manifest,records)
    if not args.offline_baselines and not args.run_consented_experiment:
        return {'status':'blocked','actual_model_calls':0,'reason':'explicit_opt_in_required'}
    consent,consent_sha256=consent_preflight(root,manifest,args) if args.run_consented_experiment else (None,None)
    if consent and any(r['arm']=='model' and r['attempted'] and
            (r['status']!='completed' or (r.get('grade') or {}).get('critical')) for r in records):
        raise ValueError('prior_live_failure_requires_review_no_automatic_resume')
    if consent:
        private_consent=root/'private-consent.json'
        binding_path=root/'collection-bindings.json'
        if binding_path.exists():
            prior=read_json(binding_path)
            if prior['consent_sha256']!=consent_sha256 or prior['manifest_sha256']!=manifest['manifest_sha256']:
                raise ValueError('collection_consent_identity_changed')
        write_json(private_consent,consent)
        collection_binding={'manifest_sha256':manifest['manifest_sha256'],'consent_sha256':consent_sha256,
                            'consent_file_sha256':sha256(private_consent),'ledger_sha256':None}
        ledger_path=root/'private-state/budget-v2.json'
        if ledger_path.exists(): collection_binding['ledger_sha256']=sha256(ledger_path)
        write_json(binding_path,collection_binding)
    node=shutil.which(args.node)
    if not node: raise ValueError('node_required')
    tasks={t['key']:t for t in manifest['tasks']}
    for record in records:
        is_model=record['arm']=='model'
        if is_model != bool(consent) or record['attempted']: continue
        task=tasks[record['task_key']]
        # Durable attempt marker precedes subprocess/provider invocation. A crash
        # can leave uncertainty, but restart cannot rerun this scheduled attempt.
        record.update(attempted=True,status='started',provenance='live' if is_model else 'fault-injected',grade=None)
        write_json(root/'records.json',records)
        folder=root/'attempts'/record['attempt_id'];folder.mkdir(parents=True,exist_ok=False)
        identifier=hashlib.sha256(record['attempt_id'].encode()).hexdigest()[:24]
        snap=snapshot(task,identifier)
        request={'schema_version':1,'session_id':snap['session_id'],'request_id':record['request_id'],'prompt':task['input']['prompt']}
        asset={'snapshot':snap,'source_path':str(inside(root,task['input']['source'])),
               'baseline_path':str(inside(root,task['input']['baseline'])),'parameters':task['input']['parameters']}
        start=time.monotonic()
        try:
            if record['arm']=='unchanged':
                result={'status':'noop','proposal':None,'preview':None};preview=None
            elif is_model:
                host={'executable':str(args.cli.resolve()),'work_directory':str(folder/'previews'),
                      'state_directory':str(root/'private-state'),'assets':[asset],'admissions':manifest['admissions']}
                write_json(folder/'private-host.json',host)
                payload={'schema_version':1,'consent_sha256':consent_sha256,**{k:consent[k] for k in ('protocol_sha256','task_sha256','schedule_sha256')},'request':request}
                argv=[node,'--experimental-strip-types',str(args.runtime/'agent/lib/live-collector.ts'),'--run-consented-experiment',
                      '--consent-file',str(args.consent.resolve()),'--manifest-file',str(folder/'private-host.json')]
                child=subprocess.run(argv,input=json.dumps(payload),text=True,capture_output=True,timeout=75,env=safe_environment(True))
                if child.returncode == 3 and len(child.stdout) <= 2*1024*1024:
                    # The collector's own stall watchdog fired. The attempt still fails below.
                    stall=retained_stall_diagnostic(child.stdout,request)
                    if stall is not None: record['collector_stall_diagnostic']=stall
                if child.returncode or len(child.stdout)>2*1024*1024: raise ValueError('production_collector_failed')
                output=strict_json(child.stdout)
                if output['request_sha256'] != request_digest(request): raise ValueError('request_digest')
                result=output['result'];preview=output.get('private_preview_path')
                validate_envelope(result,request,snap,consent,consent_sha256)
                record['accounting']=accounting(root,request,consent,consent_sha256)
                # Raw private errors/host paths are never included in report.
                record['envelope']=retained_envelope(result)
                if output.get('provider_output_diagnostic') is not None:
                    record['provider_output_diagnostic']=retained_output_diagnostic(output['provider_output_diagnostic'],request,result)
            else:
                fixture={'schema_version':1,'arm':'rules','request':request,'snapshot':snap,'asset':asset,
                         'untrusted_label':task['input'].get('untrusted_label','')}
                write_json(folder/'bridge-input.json',fixture)
                child=subprocess.run([node,'--experimental-strip-types',str(ROOT/'evals/level_bridge.mjs'),str(args.runtime.resolve()),str(args.cli.resolve()),str(folder)],
                                      text=True,capture_output=True,timeout=75,env=safe_environment())
                if child.returncode or len(child.stdout)>2*1024*1024: raise ValueError('offline_rules_bridge_failed')
                output=strict_json(child.stdout);result=output['response'];preview=output.get('preview_path')
            evidence=evidence_from_result(root,task,folder,result,preview,args.cli)
            record['evidence']=evidence;record['grade']=grade(task,root,evidence)
            record.update(status='completed',response_status=result['status'])
            if is_model:
                if result_binding_errors(record,task): raise ValueError('service_result_binding_failed')
                stop=execution_stop_reason(result,record['grade'])
                if stop:
                    record.update(status='failed',reason=stop,protocol_halt_reason=stop)
                else:
                    record['safety']={'unauthorized_changes':0,'stale_acceptances':0,'unaccounted_admissions':0,'invalid_audio_accepted':0}
        except (ValueError,KeyError,TypeError,OSError,subprocess.SubprocessError):
            record.update(status='failed',reason='invalid_or_missing_attempt_evidence',grade={'task_success':False,'critical':True,'errors':['invalid_or_missing_attempt_evidence']})
            if is_model:
                try: record['accounting']=accounting(root,request,consent,consent_sha256)
                except (ValueError,KeyError,TypeError,OSError): record['accounting']={'admitted':False,'status':'unknown','generations':0,'confirmed_usd':0,'unresolved_usd':0}
        record['latency_ms']=(time.monotonic()-start)*1000
        if is_model:
            ledger_path=root/'private-state/budget-v2.json'
            if ledger_path.exists():
                collection_binding['ledger_sha256']=sha256(ledger_path)
                write_json(root/'collection-bindings.json',collection_binding)
        # Save each outcome immediately. Reopen and independently regrade the
        # entire run once at final export, avoiding quadratic WAV rescans.
        write_json(root/'records.json',records)
        # Any corrupted evidence or uncertain admission stops the live run;
        # remaining scheduled attempts stay blocked, without substitution.
        if is_model and record['status']=='failed': break
    return report(root,manifest,records)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--experiment',type=Path,required=True);p.add_argument('--cli',type=Path,required=True)
    p.add_argument('--runtime',type=Path,required=True);p.add_argument('--node',default='node')
    mode=p.add_mutually_exclusive_group();mode.add_argument('--offline-baselines',action='store_true');mode.add_argument('--run-consented-experiment',action='store_true')
    p.add_argument('--consent',type=Path);p.add_argument('--preflight',type=Path)
    print(json.dumps(collect(p.parse_args())))
