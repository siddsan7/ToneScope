// Offline evaluation only. No provider SDK, host, network, or live policy is loaded.
import {pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const [runtime,cli,folder]=process.argv.slice(2);
if(![runtime,cli,folder].every(p=>p&&isAbsolute(p)))throw Error('absolute_host_paths_required');
delete process.env.TONESCOPE_ENABLE_LIVE;
const output={schema_version:1,status:'failed',response:null,preview_path:null,raw_actions:[],tool_trace:[],decision_inputs:[],historical_usage:null,mode_classification:'offline-capture-unqualified',rejection_errors:[]};
const exact=(value,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('invalid_capture_schema');
};
try {
  const fixture=JSON.parse(await readFile(join(folder,'bridge-input.json'),'utf8'));
  exact(fixture,['schema_version','arm','request','snapshot','asset','untrusted_label','capture']);
  if(fixture.schema_version!==1||!['rules','single-model-no-tools','tool-grounded','grounding-disabled'].includes(fixture.arm))throw Error('invalid_bridge_input');
  output.mode_classification=fixture.arm==='rules'?'offline-rules-baseline':'offline-capture-unqualified';
  if(fixture.arm!=='rules'&&!fixture.capture){
    output.status='blocked';output.reason='live_model_execution_disabled';
  } else {
    const moduleAt=name=>import(pathToFileURL(join(runtime,'agent/lib',name+'.ts')).href);
    const [{AssistantService,RulesProvider},{NativeCliAdapter},{StateStore},contracts]=await Promise.all([moduleAt('service'),moduleAt('native-cli'),moduleAt('store'),moduleAt('contracts')]);
    const request=contracts.requestSchema.parse(fixture.request);
    const snapshot=contracts.snapshotSchema.parse(fixture.snapshot);
    if(snapshot.session_id!==request.session_id||JSON.stringify(fixture.asset.snapshot)!==JSON.stringify(snapshot))throw Error('asset_snapshot_binding');
    if(fixture.untrusted_label!==undefined&&typeof fixture.untrusted_label!=='string')throw Error('invalid_untrusted_label');
    const native=new NativeCliAdapter(cli,new Map([[snapshot.session_id,fixture.asset]]),join(folder,'previews'));
    const hidden=fixture.arm==='grounding-disabled';
    const expose=(kind,result)=>hidden&&kind==='get_measurements'?{available:false,reason:'grounding_disabled'}:hidden&&kind==='render_candidate'?{preview_id:result.preview_id,session_revision:result.session_revision}:hidden&&kind==='compare_candidate'?{available:false,reason:'grounding_disabled'}:result;
    const capture=fixture.capture;
    if(capture){
      if(Array.isArray(capture.actions))output.raw_actions=structuredClone(capture.actions);
      exact(capture,['schema_version','provenance','actions','historical_usage']);
      if(capture.schema_version!==1||!capture.provenance||!['imported-capture','scripted-test'].includes(capture.provenance.kind)||typeof capture.provenance.model!=='string'||!Array.isArray(capture.actions)||capture.actions.length>8)throw Error('invalid_capture_schema');
      output.provenance=structuredClone(capture.provenance);
      output.capture_classification=capture.provenance.kind==='scripted-test'?'scripted-test-actions-unqualified':'imported-actions-unqualified';
      output.historical_usage=capture.historical_usage??null;
    }
    const wrapTools=tools=>new Proxy(tools,{get(target,key){
      if(!['snapshot','measurements','render','compare','propose'].includes(key))return Reflect.get(target,key,target);
      return async input=>{
        const kind={snapshot:'get_session_snapshot',measurements:'get_measurements',render:'render_candidate',compare:'compare_candidate',propose:'propose_change'}[key];
        try{const result=await target[key](input);
          let artifact;
          if(key==='render'){
            await native.verifyPreview(snapshot,result,target.signal);
            const source=native.previewPath(snapshot.session_id,result.preview_id);
            const directory=join(folder,'candidate-evidence');
            await mkdir(directory,{recursive:true});
            const path=join(directory,result.preview_id+'.wav');
            await copyFile(source,path);
            await copyFile(source+'.json',path+'.json');
            const sha256=createHash('sha256').update(await readFile(path)).digest('hex');
            if(sha256!==result.audio_sha256)throw Error('candidate_evidence_digest_mismatch');
            artifact={path,sidecar_path:path+'.json',sha256};
          }
          output.tool_trace.push({kind,input:input??{},result:expose(kind,result),...(artifact?{artifact}:{} )});return result;}
        catch(error){output.tool_trace.push({kind,input:input??{},error:error.message});throw error;}
      };
    }});
    class CapturedProvider {
      kind='replay';
      async run(r,actual){
        try{return await this.replay(r,actual);}catch(error){output.rejection_errors.push(error.message);throw error;}
      }
      async replay(r,actual){
        const tools=wrapTools(actual),s=await tools.snapshot(),measurements=await tools.measurements();
        output.decision_inputs.push({kind:'initial',request:r,snapshot:s,measurements:expose('get_measurements',measurements),...(fixture.untrusted_label===undefined?{}:{untrusted_label:fixture.untrusted_label})});
        let candidates=0,lastPreview,terminal;
        const synthesize=patch=>({schema_version:1,request_id:r.request_id,session_revision:s.session_revision,source_sha256:s.source_sha256,base_graph_sha256:s.base_graph_sha256,selection_samples:s.selection_samples,hypotheses:['The captured patch is evaluated by the offline wrapper.'],evidence_refs:measurements,parameter_patch:patch,expected_tradeoffs:['Level changes can change sample peak headroom.'],limitations:['Evaluation wrapper supplied evidence; captured actions do not establish model review or competence.'],requires_user_acceptance:true});
        if(fixture.arm==='single-model-no-tools'&&capture.actions.length!==1)throw Error('one_shot_requires_single_action');
        for(const action of capture.actions){
          exact(action,['kind','input']);
          if(terminal)throw Error('action_after_terminal');
          if(action.kind==='noop'||action.kind==='abstain'){
            exact(action.input,['reason']);if(typeof action.input.reason!=='string'||!action.input.reason.trim()||action.input.reason.length>500)throw Error('invalid_capture_schema');
            terminal={status:action.kind,reason:action.input.reason};continue;
          }
          if(action.kind==='render_candidate'){
            if(++candidates>2)throw Error('evaluation_candidate_limit');
            const patch=contracts.renderInput.parse(action.input).parameter_patch;
            lastPreview=await tools.render(action.input);
            const comparison=await tools.compare({preview_id:lastPreview.preview_id});
            if(fixture.arm==='single-model-no-tools'){
              output.proposal_origin='evaluation-wrapper';
              output.evaluation_wrapper=true;
              terminal={status:'ready',preview_id:lastPreview.preview_id,proposal:synthesize(patch)};
            }
            else output.decision_inputs.push({kind:'candidate_feedback',preview:expose('render_candidate',lastPreview),comparison:expose('compare_candidate',comparison)});
          }else if(action.kind==='get_session_snapshot'&&fixture.arm!=='single-model-no-tools'){
            contracts.emptyInput.parse(action.input);
            output.decision_inputs.push({kind:'snapshot_feedback',snapshot:await tools.snapshot()});
          }else if(action.kind==='get_measurements'&&fixture.arm!=='single-model-no-tools'){
            contracts.emptyInput.parse(action.input);
            output.decision_inputs.push({kind:'measurement_feedback',measurements:expose('get_measurements',await tools.measurements())});
          }else if(action.kind==='compare_candidate'&&fixture.arm!=='single-model-no-tools'){
            contracts.previewInput.parse(action.input);
            output.decision_inputs.push({kind:'comparison_feedback',comparison:expose('compare_candidate',await tools.compare(action.input))});
          }else if(action.kind==='propose_change'&&fixture.arm!=='single-model-no-tools'){
            if(!lastPreview)throw Error('evaluated_preview_required');
            const keys=Object.keys(action.input??{});
            const wrapper=keys.length===1&&keys[0]==='parameter_patch';
            const proposal=wrapper?synthesize(contracts.renderInput.parse(action.input).parameter_patch):contracts.proposalSchema.parse(action.input);
            if(wrapper){output.proposal_origin='evaluation-wrapper';output.evaluation_wrapper=true;}
            terminal={status:'ready',preview_id:lastPreview.preview_id,proposal};
          }else throw Error('invalid_capture_action');
        }
        if(!terminal)throw Error('terminal_action_required');
        return terminal;
      }
    }
    class TracedRules extends RulesProvider {
      async run(r,t,signal){return super.run(r,wrapTools(t),signal);}
    }
    const provider=fixture.arm==='rules'?new TracedRules():new CapturedProvider();
    const service=new AssistantService(native,new StateStore(join(folder,'state')),provider);
    output.response=await service.run(request);
    output.status=output.response.status==='failed'||output.response.status==='timed_out'||output.response.status==='canceled'?'failed':'completed';
    if(output.response.reason&&output.status==='failed')output.rejection_errors.push(output.response.reason);
    if(output.response.preview){
      await native.verifyPreview(snapshot,output.response.preview,new AbortController().signal);
      output.preview_path=native.previewPath(snapshot.session_id,output.response.preview.preview_id);
      if(createHash('sha256').update(await readFile(output.preview_path)).digest('hex')!==output.response.preview.audio_sha256)throw Error('preview_digest_mismatch');
    }
  }
}catch(error){output.status='failed';output.reason=error.message;output.rejection_errors.push(error.message);output.preview_path=null;}
const decisionText=JSON.stringify({schema_version:1,mode_classification:output.mode_classification,decision_inputs:output.decision_inputs},null,2);
await writeFile(join(folder,'decision-inputs.json'),decisionText);
output.decision_inputs_sha256=createHash('sha256').update(decisionText).digest('hex');
await writeFile(join(folder,'bridge-output.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify(output));
