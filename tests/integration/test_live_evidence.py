"""Scheduled denominators, independent negative oracles and opt-in boundaries."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "evals"))
from level_tasks import load_corpus, canonical_hash
from compression_tasks import load_corpus as compression_corpus
from live_evidence import schedule, initial_records, summarize, grade, report, verify_manifest, write_json, read_json, reconcile_live, scheduled_request, utf8_hash
from level_audio import measure_audio
from oracles import write_float_wav, sha256
from live_collect import consent_preflight, snapshot, safe_environment, evidence_from_result, retained_envelope
from types import SimpleNamespace
from live_freeze import render, check_transfer
from compression_tasks import fixture_samples as compression_samples
from compression_audio import grade_compression
from oracles import read_wav


def tasks():
    rows = []
    for family, corpus in (("level", load_corpus()), ("compression", compression_corpus())):
        for task in corpus["tasks"]:
            rows.append({"key": family + '-' + task["task_id"], "set": "development", "family": family,
                         "reference": task, "input_sha256": canonical_hash(task)})
    for i in range(16):
        task = copy.deepcopy(rows[i % 24])
        task.update(key=f"transfer-{i}", set="transfer", family="level" if i < 8 else "compression")
        rows.append(task)
    return rows


def add_admissions(manifest):
    by_key={t['key']:t for t in manifest['tasks']}
    for t in by_key.values(): t.setdefault('input',{}).setdefault('prompt','public test prompt')
    key=next(iter(by_key));prompt=by_key[key]['input']['prompt']
    manifest['reserved_requests']=[{'kind':role,'request_id':role+str(i),'task_key':key,'prompt':prompt} for role in ('setup','lifecycle') for i in range(6)]
    manifest['admissions']=[{'request_id':r['request_id'],'prompt_sha256':hashlib.sha256(by_key[r['task_key']]['input']['prompt'].encode()).hexdigest(),'role':'scored'}
                            for r in manifest['schedule'] if r['arm']=='model']+[
        {'request_id':r['request_id'],'prompt_sha256':hashlib.sha256(r['prompt'].encode()).hexdigest(),'role':r['kind']} for r in manifest['reserved_requests']]
    manifest['admissions_sha256']=canonical_hash(manifest['admissions'])
    manifest['admissions'].sort(key=lambda a:a['request_id'])
    manifest['admissions_sha256']=canonical_hash(manifest['admissions'])
    return manifest


class ScheduleTests(unittest.TestCase):
    def test_retained_service_result_preserves_structures_and_redacts_free_prose(self):
        result={'authorization':{},'trace':{},'snapshots':[],'usage':{},'status':'ready','request_id':'request','trace_id':'trace',
                'evidence_refs':[],'proposal':{'parameter_patch':[{'parameter_id':'outputDb','value':-3}],
                'hypotheses':['private prose'],'expected_tradeoffs':['private prose'],'limitations':['private prose']},
                'preview':{'preview_id':'preview','audio_sha256':'a'*64,'measurements':[]},'reason':'private raw error'}
        retained=retained_envelope(result)
        self.assertEqual(retained['proposal']['parameter_patch'],result['proposal']['parameter_patch'])
        self.assertEqual(retained['preview'],result['preview'])
        self.assertNotIn('private',json.dumps(retained))
        self.assertEqual(result['proposal']['hypotheses'],['private prose'])

    def test_missing_production_response_is_an_attempt_failure(self):
        with self.assertRaisesRegex(ValueError,'missing_or_invalid_production_response'):
            evidence_from_result(Path('.'),{},Path('.'),None,None,Path('unused'))

    def test_atomic_replace_transient_windows_sharing_lock_preserves_old_snapshot(self):
        (ROOT/'artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'artifacts') as tmp:
            target=Path(tmp)/'records.json';write_json(target,{'version':'old'})
            replace=os.replace;calls=[]
            def sharing(source,destination):
                calls.append(1)
                self.assertEqual(read_json(target),{'version':'old'})
                if len(calls)<3:
                    error=PermissionError('temporary sharing lock');error.winerror=32;raise error
                return replace(source,destination)
            with patch('live_evidence.os.replace',side_effect=sharing): write_json(target,{'version':'new'})
            self.assertEqual(len(calls),3)
            self.assertEqual(read_json(target),{'version':'new'})

    def test_atomic_replace_permanent_windows_sharing_lock_fails_with_old_snapshot(self):
        (ROOT/'artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'artifacts') as tmp:
            target=Path(tmp)/'records.json';write_json(target,{'version':'old'})
            error=PermissionError('persistent sharing lock');error.winerror=32
            with patch('live_evidence.os.replace',side_effect=error) as replacement:
                with self.assertRaises(PermissionError): write_json(target,{'version':'new'})
            self.assertEqual(replacement.call_count,6)
            self.assertEqual(read_json(target),{'version':'old'})
            self.assertEqual(list(Path(tmp).iterdir()),[target])

    def test_atomic_records_survive_process_exit_at_each_replace_barrier(self):
        (ROOT/'artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'artifacts') as tmp:
            target=Path(tmp)/'records.json'
            code="import os,sys;sys.path.insert(0,sys.argv[1]);from live_evidence import write_json;write_json(sys.argv[2],{'version':'new','records':list(range(1000))},lambda point:os._exit(23) if point==sys.argv[3] else None)"
            for barrier in ('written','before_replace','after_replace'):
                for repeat in range(3):
                    write_json(target,{'version':'old','records':[1,2,3]})
                    child=subprocess.run([sys.executable,'-c',code,str(ROOT/'evals'),str(target),barrier],capture_output=True,text=True,timeout=10)
                    self.assertEqual(child.returncode,23)
                    actual=read_json(target)
                    self.assertEqual(actual,{'version':'new','records':list(range(1000))} if barrier=='after_replace' else {'version':'old','records':[1,2,3]})

    def test_live_entrypoint_requires_explicit_opt_in_before_any_process(self):
        for values in ({}, {'run_consented_experiment':True}, {'run_consented_experiment':True,'consent':Path('missing')}):
            args=SimpleNamespace(run_consented_experiment=False,consent=None,preflight=None)
            args.__dict__.update(values)
            with self.assertRaisesRegex(ValueError,'explicit_live_opt_in'):
                consent_preflight(Path('.'),{},args)

    def test_complete_pairs_and_blocked_denominators(self):
        corpus = tasks()
        rows = schedule(corpus)
        self.assertEqual(len(rows), 280)
        self.assertEqual(sum(r['arm'] == 'model' for r in rows), 168)
        for task in corpus:
            self.assertEqual({r['input_sha256'] for r in rows if r['task_key'] == task['key']}, {task['input_sha256']})
        result = summarize({'tasks': corpus, 'schedule': rows}, initial_records(rows))
        self.assertFalse(result['claim_gate'])
        self.assertFalse(result['baseline_coverage_gate'])
        self.assertEqual(result['coverage'], 0)
        self.assertEqual(sum(g['scheduled'] for g in result['groups']), 168)
        self.assertEqual(result['groups'][0]['feasible_scheduled'], 45)
        self.assertEqual(result['groups'][0]['required_successes'], 41)  # ceil(.9 * 45)
        self.assertEqual(len(result['provider_context_exposure']['label_only_injection_cases_not_provider_exercised']),3)
        self.assertFalse(result['provider_context_exposure']['annotation_injection_safety_claim_supported'])

    def test_missing_duplicate_relabel_and_corrupt_attempt_fail_closed(self):
        corpus = tasks()
        rows = schedule(corpus)
        manifest = {'tasks': corpus, 'schedule': rows}
        records = initial_records(rows)
        for changed in (records[:-1], records[:-1] + [records[0]]):
            with self.assertRaises(ValueError): summarize(manifest, changed)
        records[2].update(attempted=True)
        with self.assertRaises(ValueError): summarize(manifest, records)
        records[2].update(provenance='fault-injected', status='failed')
        result = summarize(manifest, records)
        self.assertEqual(result['attempted_model'], 1)
        self.assertEqual(result['live_attempts'], 0)
        self.assertFalse(result['claim_gate'])


class AudioTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'artifacts').mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / 'artifacts')
        self.root = Path(self.tmp.name)
        self.channels = [[.12, -.23, .31, .04, -.15] * 100, [.07, .16, -.09, .21, .03] * 100]
        write_float_wav(self.root / 'base.wav', self.channels, 48000)
        write_float_wav(self.root / 'wet.wav', [[x * .5 for x in c] for c in self.channels], 48000)
        reference = {'expected_status': 'ready', 'authorized_output_db': {'value': 0, 'min': -24, 'max': 24},
                     'objective': {'kind': 'delta', 'value_db': -6.020599913279624},
                     'tolerances': {'level_db': .25, 'peak_db': .05, 'waveform_max_abs': 1e-6}}
        self.task = {'family': 'level', 'reference': reference, 'input': {'binding': {'selection_samples': [10,510],
                     'source_sha256': 'a'*64, 'graph_sha256': 'b'*64}, 'parameters': {'outputDb': 0, 'inputDb': 0},
                     'baseline': 'base.wav', 'baseline_sha256': sha256(self.root / 'base.wav')}}
        self.evidence = {'binding': copy.deepcopy(self.task['input']['binding']), 'parameters_before': {'outputDb': 0, 'inputDb': 0},
                         'parameters_after': {'outputDb': reference['objective']['value_db'], 'inputDb': 0}, 'status': 'ready',
                         'patch': [{'stage_id':'output','parameter_id':'outputDb','unit':'dB','value':reference['objective']['value_db']}],
                         'candidate':'wet.wav','candidate_sha256':sha256(self.root / 'wet.wav'),
                         'measurements':{k:v for k,v in measure_audio(self.root / 'wet.wav').items() if k in ('rms','peak','frames','channels','sample_rate')}}
        measured=measure_audio(self.root/'wet.wav')
        self.evidence['reported_preview_measurements']=[{'measurement_id':'preview_'+k,'value':measured[k],'unit':'dBFS'} for k in ('rms_dbfs','peak_dbfs')]

    def tearDown(self): self.tmp.cleanup()

    def test_real_wav_passes(self):
        self.assertTrue(grade(self.task, self.root, self.evidence)['task_success'])

    def test_forged_selection_control_and_tamper_fail_intended_check(self):
        probes = [('forged_measurements', lambda e:e['measurements'].update(rms=0)),
                  ('forged_preview_measurements',lambda e:e['reported_preview_measurements'][0].update(value=0)),
                  ('selection_source_graph_binding', lambda e:e['binding'].update(selection_samples=[0,500])),
                  ('unauthorized_control_snapshot', lambda e:e['parameters_after'].update(inputDb=1)),
                  ('candidate_tamper', lambda e:e.update(candidate_sha256='f'*64))]
        for check, change in probes:
            with self.subTest(check=check):
                evidence = copy.deepcopy(self.evidence); change(evidence)
                result = grade(self.task, self.root, evidence)
                self.assertFalse(result['task_success'])
                self.assertIn(check, result['errors'])

    def test_polarity_channel_and_timing_fail_waveform_check_even_with_forged_matching_metrics(self):
        wet = [[x*.5 for x in c] for c in self.channels]
        probes = [[[-x for x in c] for c in wet], wet[::-1], [[c[-1]]+c[:-1] for c in wet]]
        for channels in probes:
            write_float_wav(self.root / 'bad.wav', channels, 48000)
            evidence = copy.deepcopy(self.evidence)
            evidence.update(candidate='bad.wav', candidate_sha256=sha256(self.root / 'bad.wav'))
            evidence['measurements'] = {k:v for k,v in measure_audio(self.root / 'bad.wav').items() if k in evidence['measurements']}
            result = grade(self.task, self.root, evidence)
            self.assertIn('output_gain_waveform_mismatch', result['errors'])
            self.assertFalse(result['task_success'])

    def test_missing_evidence_is_failure(self):
        for key in self.evidence:
            evidence = copy.deepcopy(self.evidence); del evidence[key]
            self.assertFalse(grade(self.task, self.root, evidence)['task_success'])

    def test_report_regrades_stored_success_and_rejects_private_export(self):
        corpus=tasks()
        for task in corpus:
            task['input']=copy.deepcopy(self.task['input'])
        corpus[0].update(family='level',reference=self.task['reference'])
        rows=schedule(corpus);records=initial_records(rows)
        manifest={'tasks':corpus,'schedule':rows,'identities':{'protocol_sha256':'a'*64},'transfer_sha256':'b'*64}
        records[0].update(attempted=True,provenance='fault-injected',status='completed',evidence=copy.deepcopy(self.evidence))
        report(self.root,manifest,records)
        self.assertTrue(records[0]['grade']['task_success'])
        records[2].update(attempted=True,provenance='fault-injected',status='completed',evidence=copy.deepcopy(self.evidence))
        report(self.root,manifest,records)
        self.assertTrue(records[2]['grade']['task_success'])
        self.assertFalse(records[2]['live_eligible'])
        records[0]['evidence']['candidate_sha256']='f'*64
        records[0]['grade']={'task_success':True}
        report(self.root,manifest,records)
        self.assertFalse(records[0]['grade']['task_success'])
        records[0]['secret']='redacted-example'
        with self.assertRaisesRegex(ValueError,'private field'): report(self.root,manifest,records)

    def test_report_rederives_generic_failure_and_truncated_evidence_halts(self):
        corpus=tasks()
        for task in corpus:
            task['input']=copy.deepcopy(self.task['input'])
        corpus[0].update(family='level',reference=copy.deepcopy(self.task['reference']))
        rows=schedule(corpus)
        manifest={'tasks':corpus,'schedule':rows,'identities':{'protocol_sha256':'a'*64},'transfer_sha256':'b'*64}
        evidence=copy.deepcopy(self.evidence)
        evidence.update(status='failed',parameters_after=copy.deepcopy(evidence['parameters_before']),patch=[],candidate=None)
        evidence['measurements']={k:v for k,v in measure_audio(self.root/'base.wav').items() if k in evidence['measurements']}
        for reason in ('request_failed','response_bytes_limit','source_digest_mismatch','future_integrity_category'):
            with self.subTest(reason=reason):
                records=initial_records(rows)
                record=records[2]
                record.update(attempted=True,provenance='fault-injected',status='completed',response_status='failed',
                              evidence=copy.deepcopy(evidence),envelope={'status':'failed','failure_category':reason,'proposal':None,'preview':None},
                              protocol_halt_reason='forged_stored_reason',grade={'task_success':True})
                result=report(self.root,manifest,records)
                self.assertFalse(record['grade']['critical'])
                self.assertFalse(record['grade']['task_success'])
                self.assertEqual(record['protocol_halt_reason'],reason)
                self.assertEqual(result['protocol_halts'],[{'attempt_id':record['attempt_id'],'reason':reason}])
                self.assertFalse(result['claim_gate'])

    def test_report_scores_rejected_model_actions_only_with_known_accounting(self):
        corpus=tasks()
        for task in corpus:
            task['input']=copy.deepcopy(self.task['input'])
        corpus[0].update(family='level',reference=copy.deepcopy(self.task['reference']))
        rows=schedule(corpus)
        manifest={'tasks':corpus,'schedule':rows,'identities':{'protocol_sha256':'a'*64},'transfer_sha256':'b'*64}
        evidence=copy.deepcopy(self.evidence)
        evidence.update(status='failed',parameters_after=copy.deepcopy(evidence['parameters_before']),patch=[],candidate=None)
        evidence['measurements']={k:v for k,v in measure_audio(self.root/'base.wav').items() if k in evidence['measurements']}
        scored=('unauthorized_parameter','topology_change_forbidden','duplicate_parameter','numeric_claim_requires_structured_evidence',
                'evaluated_preview_required','forged_evidence','proposal_binding','render_limit','tool_call_limit','token_budget_reservation')
        cases=[(reason,True,None) for reason in scored]+[(reason,False,reason) for reason in scored]
        cases+=[('invalid_render_cost',True,'invalid_render_cost'),('stale_session',True,'stale_session'),('currency_budget_reservation',True,'currency_budget_reservation')]
        for reason,known,halt in cases:
            with self.subTest(reason=reason,known=known):
                records=initial_records(rows)
                record=records[2]
                record.update(attempted=True,provenance='fault-injected',status='completed',response_status='failed',
                              evidence=copy.deepcopy(evidence),envelope={'status':'failed','failure_category':reason,'proposal':None,'preview':None,
                                                                         'authorization':{'accounting_known':known}},
                              protocol_halt_reason='forged_stored_reason',grade={'task_success':True})
                result=report(self.root,manifest,records)
                self.assertFalse(record['grade']['task_success'])
                self.assertEqual(record.get('protocol_halt_reason'),halt)
                self.assertEqual(result['protocol_halts'],[{'attempt_id':record['attempt_id'],'reason':halt}] if halt else [])

    def test_report_rejects_wav_patch_preview_and_status_substitution(self):
        corpus=tasks()
        for task in corpus: task['input']=copy.deepcopy(self.task['input'])
        corpus[0].update(family='level',reference=self.task['reference'])
        rows=schedule(corpus);records=initial_records(rows);record=records[2]
        manifest={'tasks':corpus,'schedule':rows,'identities':{'protocol_sha256':'a'*64},'transfer_sha256':'b'*64}
        binding=self.task['input']['binding'];digest=self.evidence['candidate_sha256'];preview_id='preview_fixture'
        proposal={'schema_version':1,'request_id':record['request_id'],'session_revision':1,
                  'source_sha256':binding['source_sha256'],'base_graph_sha256':binding['graph_sha256'],
                  'selection_samples':binding['selection_samples'],'parameter_patch':copy.deepcopy(self.evidence['patch']),
                  'hypotheses':['Bounded level change.'],'evidence_refs':[], 'expected_tradeoffs':['Headroom changes.'],
                  'limitations':['No listening claim.'],'requires_user_acceptance':True}
        preview={'preview_id':preview_id,'audio_sha256':digest,'session_revision':1,
                 'measurements':copy.deepcopy(self.evidence['reported_preview_measurements'])}
        events=[{'sequence':1,'category':'render','preview_id':preview_id,'audio_sha256':digest},
                {'sequence':2,'category':'compare','preview_id':preview_id},
                {'sequence':3,'category':'verified_preview','preview_id':preview_id,'audio_sha256':digest},
                {'sequence':4,'category':'terminal'}]
        record.update(attempted=True,provenance='fault-injected',status='completed',response_status='ready',evidence=copy.deepcopy(self.evidence),
                      envelope={'status':'ready','request_id':record['request_id'],'proposal':proposal,'preview':preview,
                                'evidence_refs':[],'trace':{'events':events}})
        valid=copy.deepcopy(record)
        report(self.root,manifest,records)
        self.assertTrue(record['grade']['task_success'])
        replacement=self.root/'replacement.wav'
        write_float_wav(replacement,[[x*.5+1e-8 for x in c] for c in self.channels],48000)
        for kind in ('wav','patch','preview','status','response_status','duplicate_verified','render'):
            with self.subTest(substitution=kind):
                record.clear();record.update(copy.deepcopy(valid))
                if kind=='wav':
                    record['evidence'].update(candidate='replacement.wav',candidate_sha256=sha256(replacement))
                    measured=measure_audio(replacement)
                    record['evidence']['measurements']={k:measured[k] for k in record['evidence']['measurements']}
                    record['evidence']['reported_preview_measurements']=[{'measurement_id':'preview_'+k,'value':measured[k],'unit':'dBFS'} for k in ('rms_dbfs','peak_dbfs')]
                    self.assertTrue(grade(corpus[0],self.root,record['evidence'])['task_success'])
                elif kind=='patch': record['envelope']['proposal']['parameter_patch'][0]['value']=-3
                elif kind=='preview': record['envelope']['preview']['audio_sha256']='f'*64
                elif kind=='status': record['envelope']['status']='noop'
                elif kind=='response_status': record['response_status']='noop'
                elif kind=='duplicate_verified': record['envelope']['trace']['events'].insert(3,copy.deepcopy(events[2]))
                else: record['envelope']['trace']['events'][0]['audio_sha256']='f'*64
                report(self.root,manifest,records)
                self.assertFalse(record['grade']['task_success'])

    def test_manifest_rejects_missing_or_tampered_artifacts_and_schedule(self):
        corpus=tasks();rows=schedule(corpus)
        manifest={'tasks':corpus,'schedule':rows,'classification':'frozen-transfer-not-sequestered-holdout','retries':0,
                  'artifacts':[{'path':'base.wav','sha256':sha256(self.root/'base.wav')}]}
        add_admissions(manifest)
        manifest['manifest_sha256']=canonical_hash(manifest)
        verify_manifest(self.root,manifest)
        (self.root/'base.wav').write_bytes(b'tamper')
        with self.assertRaisesRegex(ValueError,'tamper'): verify_manifest(self.root,manifest)

    def test_copied_live_envelope_and_stored_accounting_tamper_fail_report_reconciliation(self):
        corpus=tasks()
        for t in corpus:
            t['input']=copy.deepcopy(self.task['input']);t['input']['prompt']='bounded test prompt'
            t['input']['controls']=[{'stage_id':'output','parameter_id':'outputDb','unit':'dB','value':0,'min':-24,'max':24}]
            t['input']['processing']={'compressor':False,'multiband':False,'equalizer':False,'drive':False}
            t['reference']=copy.deepcopy(self.task['reference'])
        rows=schedule(corpus);records=initial_records(rows)
        manifest=add_admissions({'tasks':corpus,'schedule':rows,'identities':{'protocol_sha256':'a'*64},'transfer_sha256':'b'*64})
        manifest['manifest_sha256']=canonical_hash(manifest)
        consent={'experiment_id':'fixture','budget_id':'fixture','protocol_sha256':'a'*64,'task_sha256':'b'*64,
                 'schedule_sha256':canonical_hash(rows),'admissions_sha256':manifest['admissions_sha256'],'budget_usd':1}
        write_json(self.root/'private-consent.json',consent)
        ledger={'schema_version':2,'consent_sha256':'c'*64,'budget_id':'fixture','committed':.003,'requests':3,'generations':3,'records':{}}
        model=[r for r in records if r['arm']=='model'][:3]
        for i,r in enumerate(model):
            request=scheduled_request(r,corpus[0]);bound={'session_id':request['session_id'],'request_id':r['request_id'],'request_sha256':utf8_hash(request)}
            terminal={'cost_usd':.001,'input_tokens':10,'output_tokens':5,'known':True}
            item={'binding':bound,'reserved_usd':.016,'phase':'terminal','generations':1,'terminal':terminal}
            ledger['records'][hashlib.sha256((request['session_id']+'\0'+r['request_id']).encode()).hexdigest()]=item
            trace_id='trace'+str(i)
            trace={'trace_id':trace_id,'attempt_id':r['request_id'],'request_id':r['request_id'],'session_id':request['session_id'],
                   'experiment_id':'fixture','consent_sha256':'c'*64,'provenance':'live','events':[{'sequence':1,'category':'generation_start'}]}
            envelope={'request_id':r['request_id'],'trace_id':trace_id,'trace':trace,'snapshots':[{'session_id':request['session_id']}],
                      'usage':{'cost_usd':.001,'input_tokens':10,'output_tokens':5},'authorization':{'consent_sha256':'c'*64,'experiment_id':'fixture','budget_id':'fixture','accounting_known':True}}
            accounting={'admitted':True,'status':'settled','generations':1,'confirmed_usd':.001,'unresolved_usd':0,'binding':bound,'phase':'terminal','terminal':terminal}
            r.update(attempted=True,status='completed',provenance='live',envelope=envelope,accounting=accounting)
        (self.root/'private-state').mkdir()
        write_json(self.root/'private-state/budget-v2.json',ledger)
        binding={'manifest_sha256':manifest['manifest_sha256'],'consent_sha256':'c'*64,
                 'consent_file_sha256':sha256(self.root/'private-consent.json'),'ledger_sha256':sha256(self.root/'private-state/budget-v2.json')}
        write_json(self.root/'collection-bindings.json',binding)
        self.assertEqual(reconcile_live(self.root,manifest,records)['status'],'verified')
        original=copy.deepcopy(model[1]['envelope'])
        model[1]['envelope']=copy.deepcopy(model[0]['envelope'])
        result=reconcile_live(self.root,manifest,records)
        self.assertIn('copied_or_mismatched_request_session_trace',result['errors'])
        model[1]['envelope']=original
        model[1]['envelope']['trace_id']=model[0]['envelope']['trace_id']
        model[1]['envelope']['trace']['trace_id']=model[0]['envelope']['trace_id']
        self.assertIn('copied_or_mismatched_request_session_trace',reconcile_live(self.root,manifest,records)['errors'])
        model[1]['envelope']=original=copy.deepcopy(original)
        model[1]['envelope']['trace_id']='trace1';model[1]['envelope']['trace']['trace_id']='trace1'
        model[1]['accounting']['confirmed_usd']=0
        result=reconcile_live(self.root,manifest,records)
        self.assertIn('stored_accounting_tamper',result['errors'])
        model[1]['status']='started'
        result=reconcile_live(self.root,manifest,records)
        self.assertIn('interrupted_admission_reconciled',result['errors'])
        self.assertEqual(model[1]['recovered_accounting']['confirmed_usd'],.001)
        # A real pre-response interruption has no exported envelope or terminal
        # usage. Recover its full reservation without reconstructing a success.
        del model[1]['envelope']
        key=hashlib.sha256((scheduled_request(model[1],corpus[0])['session_id']+'\0'+model[1]['request_id']).encode()).hexdigest()
        ledger['records'][key].update(terminal=None,phase='dispatched')
        ledger['committed']=.018
        write_json(self.root/'private-state/budget-v2.json',ledger)
        binding['ledger_sha256']=sha256(self.root/'private-state/budget-v2.json')
        write_json(self.root/'collection-bindings.json',binding)
        result=reconcile_live(self.root,manifest,records)
        self.assertIn('interrupted_admission_reconciled',result['errors'])
        self.assertEqual(model[1]['recovered_accounting']['unresolved_usd'],.016)
        self.assertEqual(model[1]['recovered_accounting']['generations'],1)
        ledger['committed']=0
        write_json(self.root/'private-state/budget-v2.json',ledger)
        self.assertIn('ledger_totals',reconcile_live(self.root,manifest,records)['errors'])


class NativeCompressionTests(unittest.TestCase):
    def test_actual_rules_bridge_accepts_paired_compression_snapshot(self):
        cli=os.environ.get('TONESCOPE_TEST_CLI');runtime=os.environ.get('TONESCOPE_ASSISTANT_RUNTIME')
        if not cli or not runtime or not (Path(runtime)/'node_modules/zod/package.json').is_file():
            if os.environ.get('TONESCOPE_REQUIRE_NATIVE_TESTS')=='1': self.fail('native CLI and installed service runtime required')
            self.skipTest('native CLI/service runtime unavailable')
        corpus=compression_corpus();reference=next(t for t in corpus['tasks'] if t['expected_status']=='ready')
        (ROOT/'artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'artifacts') as tmp:
            folder=Path(tmp);source=folder/'source.wav'
            write_float_wav(source,compression_samples(corpus['fixtures'][reference['fixture_id']]),corpus['sample_rate'])
            baseline,manifest=render(cli,source,reference['parameters'],folder,'baseline')
            from compression_eval import registry
            task={'key':'contract','input':{'binding':{'source_sha256':sha256(source),'graph_sha256':manifest['graph_sha256'],
                  'selection_samples':[0,corpus['frames']],'sample_rate':corpus['sample_rate']},'controls':registry(reference),
                  'processing':{k:reference['parameters'][k] for k in ('compressor','multiband','equalizer','drive')},'passages':reference['passages']}}
            snap=snapshot(task,'fixture')
            fixture={'schema_version':1,'arm':'rules','request':{'schema_version':1,'request_id':'fixture','session_id':snap['session_id'],'prompt':reference['prompt']},
                     'snapshot':snap,'asset':{'snapshot':snap,'source_path':str(source),'baseline_path':str(baseline),'parameters':reference['parameters']}}
            write_json(folder/'bridge-input.json',fixture)
            child=subprocess.run(['node','--experimental-strip-types',str(ROOT/'evals/level_bridge.mjs'),str(Path(runtime).resolve()),str(Path(cli).resolve()),str(folder)],
                                 capture_output=True,text=True,timeout=75,env=safe_environment())
            self.assertEqual(child.returncode,0)
            output=json.loads(child.stdout)
            self.assertIsNotNone(output['response'],output.get('reason'))
            self.assertEqual(output['response']['status'],'ready')
            result=grade_compression(reference,baseline,output['preview_path'],status='ready',patch=output['response']['proposal']['parameter_patch'])
            self.assertTrue(result['task_success'],result['errors'])

    def test_actual_native_witness_and_compression_negative_oracles(self):
        cli=os.environ.get('TONESCOPE_TEST_CLI')
        if not cli or not Path(cli).is_file():
            if os.environ.get('TONESCOPE_REQUIRE_NATIVE_TESTS')=='1': self.fail('native CLI required')
            self.skipTest('native CLI unavailable; no native qualification')
        corpus=compression_corpus();task=next(t for t in corpus['tasks'] if t['expected_status']=='ready' and t['objective']['reduction_db']==3)
        (ROOT/'artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'artifacts') as tmp:
            folder=Path(tmp);source=folder/'source.wav'
            write_float_wav(source,compression_samples(corpus['fixtures'][task['fixture_id']]),corpus['sample_rate'])
            baseline,_=render(cli,source,task['parameters'],folder,'baseline')
            witness=None
            for threshold in (-16,-18,-20,-22,-24,-26,-28,-30):
                parameters={**task['parameters'],'thresholdDb':threshold}
                candidate,_=render(cli,source,parameters,folder,'candidate'+str(-threshold))
                patch=[{'stage_id':'compressor','parameter_id':'thresholdDb','unit':'dBFS','value':threshold}]
                result=grade_compression(task,baseline,candidate,status='ready',patch=patch)
                if result['task_success']: witness=(candidate,patch);break
            self.assertIsNotNone(witness,'fixed native witness sweep must pass before probes')
            rate,channels=read_wav(witness[0])
            variants={'polarity':[[-x for x in c] for c in channels], 'channel':channels[::-1],
                      'timing':[[c[-1]]+c[:-1] for c in channels]}
            for name,samples in variants.items():
                with self.subTest(probe=name):
                    path=folder/(name+'.wav');write_float_wav(path,samples,rate)
                    result=grade_compression(task,baseline,path,status='ready',patch=witness[1])
                    self.assertFalse(result['task_success'])
                    self.assertIn('not_linked_nonnegative_attenuation',result['errors'])


if __name__ == '__main__': unittest.main()
