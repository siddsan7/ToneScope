"""Prepare and seal paired inputs offline. This module cannot invoke a provider.

Transfer prompts/references are supplied by the evaluation owner in a private
pack. They must not be included in a model context or a public source commit.
"""
import argparse
from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from compression_eval import registry
from compression_tasks import load_corpus as compression_corpus, fixture_samples as compression_samples
from level_tasks import ROOT, load_corpus as level_corpus, fixture_samples as level_samples, canonical_hash
from live_protocol import validate
from live_evidence import read_json, write_json, inside, schedule, initial_records, report
from level_audio import measure_audio
from compression_audio import grade_compression
from oracles import sha256, write_float_wav, read_wav
from provenance import source_identity


def runtime_identity(runtime):
    paths = [Path(runtime)/'package-lock.json', *sorted((Path(runtime)/'agent/lib').glob('*.ts'))]
    return canonical_hash({p.relative_to(runtime).as_posix():sha256(p) for p in paths})


def native(cli, arguments):
    child = subprocess.run([str(cli), *map(str, arguments)], capture_output=True, text=True, timeout=75)
    if child.returncode or len(child.stdout) > 2 * 1024 * 1024:
        raise ValueError("native_preparation_failed")
    from level_tasks import strict_json
    return strict_json(child.stdout)


def render(cli, source, parameters, folder, name, selection=None):
    config, audio = folder / (name + '.json'), folder / (name + '.wav')
    write_json(config, {'schema_version': 1, 'source_sha256': sha256(source), 'parameters': parameters})
    args = ['render', '--source', source, '--out', audio, '--session', config]
    if selection is not None:
        args.extend(['--start', selection[0], '--end', selection[1]])
    value = native(cli, args)
    if value['source_sha256'] != sha256(source) or value['artifact_sha256'] != sha256(audio):
        raise ValueError('native_render_binding')
    return audio, value


def check_transfer(pack_root, pack):
    if pack.get('schema_version') != 1 or pack.get('classification') != 'frozen-transfer-not-sequestered-holdout':
        raise ValueError('transfer_classification')
    tasks = pack['tasks']
    categories = Counter(t['primary_category'] for t in tasks)
    if categories != {'explicit-level': 4, 'evidence-compression': 4, 'language-variant': 4, 'negative': 4}:
        raise ValueError('transfer_category_counts')
    if len({t['task_id'] for t in tasks}) != 16:
        raise ValueError('transfer_task_identity')
    sources = pack['sources']
    if len(sources) < 4:
        raise ValueError('four_licensed_excerpts_required')
    approved=read_json(ROOT/'evals/datasets/guitar-techs-public.json')
    originals={item['sha256']:(i,item) for i,item in enumerate(approved['records'])}
    for source in sources.values():
        if source['license'] != 'CC-BY-4.0' or not source['attribution'] or not source['performance_group']:
            raise ValueError('source_license_or_group_missing')
        if sha256(inside(pack_root, source['path'])) != source['sha256']:
            raise ValueError('source_tamper')
        if source.get('original_sha256') not in originals or source.get('attribution')!=approved['attribution'] or source.get('source_url')!=approved['source_url']:
            raise ValueError('source_not_approved_DI')
        index,original=originals[source['original_sha256']]
        original_path=inside(pack_root,f'original-{index}.wav')
        if sha256(original_path)!=original['sha256'] or source['performance_group']!=original['performance_group']:
            raise ValueError('original_provenance_tamper')
        rate,original_audio=read_wav(original_path)
        excerpt_rate,excerpt=read_wav(inside(pack_root,source['path']))
        start,end=source['excerpt_seconds']
        if (type(start) is not int or type(end) is not int or not 0<=start<end or end-start>10 or excerpt_rate!=rate
            or excerpt!=[c[start*rate:end*rate] for c in original_audio]):
            raise ValueError('excerpt_not_exact_approved_DI')
    for task in tasks:
        if task['family'] not in ('level', 'compression') or task['source_id'] not in sources:
            raise ValueError('transfer_family_source')
        if task['primary_category'] != 'negative' and task['reference']['expected_status'] != 'ready':
            raise ValueError('feasible_transfer_decision')
        if task['primary_category'] == 'negative' and task['reference']['expected_status'] not in ('noop','abstain'):
            raise ValueError('negative_decision')
        if not isinstance(task['prompt'], str) or not 0 < len(task['prompt'].encode()) <= 8192:
            raise ValueError('transfer_prompt')
        reference=task['reference']
        if task['family']=='level':
            if reference['tolerances']!={'level_db':.25,'peak_db':.05,'waveform_max_abs':1e-6}:
                raise ValueError('transfer_level_gate_drift')
            bounds=reference['authorized_output_db']
            if not -24<=bounds['min']<=bounds['value']<=bounds['max']<=24 or bounds['value']!=task['parameters']['outputDb']:
                raise ValueError('transfer_level_bounds')
        else:
            if (reference['tolerances']!={'contrast_db':.5,'soft_db':.05,'peak_db':.05}
                or reference['objective']['soft_max_change_db']!=.5 or reference['objective']['peak_ceiling_dbfs']!=-1):
                raise ValueError('transfer_compression_gate_drift')
            bounds=reference['authorized_threshold_db']
            if not -60<=bounds['min']<=bounds['value']<=bounds['max']<=0 or bounds['value']!=task['parameters']['thresholdDb']:
                raise ValueError('transfer_threshold_bounds')
    if pack['exposure']['sequestered'] is not False:
        raise ValueError('shared_repository_cannot_attest_sequestration')
    return tasks


def freeze(args):
    protocol = validate()
    out, cli, transfer = args.output.resolve(), args.cli.resolve(), args.transfer.resolve()
    if out.exists():
        raise ValueError('fresh_output_required')
    pack = read_json(transfer)
    check_transfer(transfer.parent, pack)
    out.mkdir(parents=True)
    (out / 'sources').mkdir()
    (out / 'tasks').mkdir()
    identity = native(cli, ['build-info'])
    current_source=source_identity(ROOT)
    runtime=args.lockfile.resolve().parent
    current_adapter=runtime_identity(runtime)
    if ((args.source_identity and args.source_identity != current_source) or
            (args.adapter_identity and args.adapter_identity != current_adapter)):
        raise ValueError('supplied_source_or_adapter_identity_mismatch')
    transfer_file_sha256=sha256(transfer)
    identities = {'binary_sha256': sha256(cli), 'compiled': identity,
                  'source_snapshot_sha256': current_source, 'adapter_prompt_sha256': current_adapter,
                  'lockfile_sha256': sha256(args.lockfile), 'protocol_sha256': protocol['protocol_sha256']}
    if any(not isinstance(identities[k], str) or len(identities[k]) != 64 for k in ('source_snapshot_sha256','adapter_prompt_sha256')):
        raise ValueError('explicit_full_source_and_adapter_identity_required')
    tasks = []
    def add(key, dataset, family, prompt, source, parameters, reference, category, group, selection=None, proof=None):
        properties = read_json(ROOT / 'libs/contracts/session.schema.json')['properties']['parameters']['properties']
        complete = {k:copy.deepcopy(v['default']) for k,v in properties.items() if 'default' in v}
        complete['order'] = [0,1,2]
        parameters = {**complete, **parameters}
        folder = out / 'tasks' / key
        folder.mkdir()
        baseline, manifest = render(cli, source, parameters, folder, 'baseline', selection)
        measurements = measure_audio(baseline)
        span = selection or [0, measurements['frames']]
        binding = {'source_sha256': sha256(source), 'graph_sha256': manifest['graph_sha256'],
                   'selection_samples': span, 'sample_rate': measurements['sample_rate'],
                   'channels': measurements['channels'], 'frames': measurements['frames'],
                   'latency_samples': manifest['latency_samples'], 'binary_sha256': identities['binary_sha256']}
        controls = (registry(reference) if family == 'compression' else
                    [{'stage_id':'output','parameter_id':'outputDb','unit':'dB',**reference['authorized_output_db']}])
        data = {'prompt': prompt, 'untrusted_label':reference.get('untrusted_label',''),
                'source': source.relative_to(out).as_posix(), 'source_group': group,
                'parameters': parameters, 'controls': controls, 'binding': binding,
                'baseline': baseline.relative_to(out).as_posix(), 'baseline_sha256': sha256(baseline),
                'passages': reference.get('passages'), 'processing': {k:parameters.get(k,False) for k in ('compressor','multiband','equalizer','drive')}}
        # Hidden reference controls are never passed to the production runner.
        if dataset == 'transfer' and reference['expected_status'] == 'ready':
            if proof is None:
                raise ValueError('transfer_feasibility_proof_required')
            candidate_parameters = copy.deepcopy(parameters)
            allowed = 'outputDb' if family == 'level' else 'thresholdDb'
            candidate_parameters[allowed] = proof['value']
            candidate, _ = render(cli, source, candidate_parameters, folder, 'feasibility', selection)
            patch = [{'stage_id':'output' if family=='level' else 'compressor','parameter_id':allowed,
                      'unit':'dB' if family=='level' else 'dBFS','value':proof['value']}]
            from level_audio import grade_audio
            result = (grade_audio if family == 'level' else grade_compression)(reference, baseline, candidate,status='ready',patch=patch)
            if not result['task_success']:
                write_json(folder / 'failed-feasibility.json', result)
                raise ValueError('transfer_native_feasibility_failed')
            write_json(folder / 'feasibility-proof.json', {'method':'independent-native-render', 'grade':result,
                       'candidate_sha256':sha256(candidate),'binary_sha256':identities['binary_sha256']})
        tasks.append({'key':key,'set':dataset,'family':family,'category':category,'source_group':group,
                      'reference':reference,'input':data,'input_sha256':canonical_hash(data)})
    for family, corpus, samples in (('level',level_corpus(),level_samples),('compression',compression_corpus(),compression_samples)):
        sources = {}
        for name, spec in corpus['fixtures'].items():
            path = out / 'sources' / (family + '-' + name + '.wav')
            write_float_wav(path, samples(spec, corpus['frames']), corpus['sample_rate'])
            if sha256(path) != spec['sha256']: raise ValueError('locked_source_drift')
            sources[name] = path
        for t in corpus['tasks']:
            parameters = t['parameters'] if family == 'compression' else {'outputDb':t['authorized_output_db']['value']}
            add(family+'-'+t['task_id'],'development',family,t['prompt'],sources[t['fixture_id']],parameters,t,t['category'],t['source_group'])
    for name, item in pack['sources'].items():
        shutil.copyfile(inside(transfer.parent,item['path']), out/'sources'/('transfer-'+name+'.wav'))
    for t in pack['tasks']:
        add('transfer-'+t['task_id'],'transfer',t['family'],t['prompt'],out/'sources'/('transfer-'+t['source_id']+'.wav'),
            t['parameters'],t['reference'],t['primary_category'],pack['sources'][t['source_id']]['performance_group'],proof=t.get('proof'))
    # Exclude native sidecars (which contain trusted host paths) from exported
    # objects; the local manifest allowlist binds all audio and configuration.
    artifacts = [{'path':p.relative_to(out).as_posix(),'sha256':sha256(p)} for p in sorted(out.rglob('*'))
                 if p.is_file() and not p.name.endswith('.wav.json')]
    rows = schedule(tasks)
    if sha256(cli)!=identities['binary_sha256'] or source_identity(ROOT)!=current_source or runtime_identity(runtime)!=current_adapter or sha256(transfer)!=transfer_file_sha256:
        raise ValueError('identity_changed_during_freeze')
    manifest = {'schema_version':1,'classification':'frozen-transfer-not-sequestered-holdout','identities':identities,
                'transfer_sha256':canonical_hash(pack),'transfer_license':pack['sources'],'exposure':pack['exposure'],
                'tasks':tasks,'schedule':rows,'retries':0,'setup_slots':6,'lifecycle_slots':6,
                'maximum_requests':180,'maximum_generations':1440,'artifacts':artifacts}
    public_level=next(t for t in tasks if t['set']=='development' and t['family']=='level' and t['reference']['expected_status']=='ready')
    public_compression=next(t for t in tasks if t['set']=='development' and t['family']=='compression' and t['reference']['expected_status']=='ready')
    public_noop=next(t for t in tasks if t['set']=='development' and t['family']=='level' and t['reference']['expected_status']=='noop')
    manifest['reserved_requests']=[]
    for i in range(6):
        manifest['reserved_requests'].append({'request_slot':f'setup-{i}','request_id':f'r_setup_{i}','kind':'setup','status':'blocked',
                                            'task_key':public_noop['key'],'prompt':public_noop['input']['prompt']})
    for name,task in (('level-apply-undo',public_level),('compression-apply-undo',public_compression),
                     ('stale-preview',public_level),('cancel',public_level),('disconnect',public_level),('noop-or-abstain',public_noop)):
        manifest['reserved_requests'].append({'request_slot':'lifecycle-'+name,'request_id':'r_lifecycle_'+name.replace('-','_'),
                                            'kind':'lifecycle','status':'blocked','task_key':task['key'],'prompt':task['input']['prompt']})
    by_key={t['key']:t for t in tasks}
    manifest['admissions']=[{'request_id':r['request_id'],'prompt_sha256':hashlib.sha256(by_key[r['task_key']]['input']['prompt'].encode()).hexdigest(),'role':'scored'}
                            for r in rows if r['arm']=='model']+[
        {'request_id':r['request_id'],'prompt_sha256':hashlib.sha256(r['prompt'].encode()).hexdigest(),'role':r['kind']} for r in manifest['reserved_requests']]
    manifest['admissions'].sort(key=lambda a:a['request_id'])
    manifest['admissions_sha256']=canonical_hash(manifest['admissions'])
    manifest['manifest_sha256'] = canonical_hash(manifest)
    write_json(out/'manifest.json',manifest)
    summary = report(out,manifest,initial_records(rows))
    write_json(out/'seal.json',{'manifest_sha256':manifest['manifest_sha256'],'transfer_sha256':manifest['transfer_sha256'],
               'categories':dict(Counter(t['primary_category'] for t in pack['tasks'])),
               'families':dict(Counter(t['family'] for t in pack['tasks'])),
               'performance_groups':len({s['performance_group'] for s in pack['sources'].values()}),
               'claim_gate':summary['claim_gate'],'actual_model_calls':0})
    return read_json(out/'seal.json')


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ('cli','transfer','output','lockfile'): p.add_argument('--'+flag,type=Path,required=True)
    p.add_argument('--source-identity');p.add_argument('--adapter-identity')
    print(json.dumps(freeze(p.parse_args())))
