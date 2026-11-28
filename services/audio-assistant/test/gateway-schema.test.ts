import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { GatewayProvider,adjustableControls,providerSchemaFor,schemaPropertyCount,PROVIDER_SCHEMA_MAX_PROPERTIES } from '../agent/lib/gateway-provider.ts';
import { AssistantService } from '../agent/lib/service.ts';
import { StateStore } from '../agent/lib/store.ts';
import { endpointMetadataDigest } from '../agent/lib/gateway-metadata.ts';
import type { NativeAdapter,Snapshot } from '../agent/lib/contracts.ts';
import { AdmissionGuard } from '../agent/lib/live-admission.ts';
import { livePolicy,defaultAdmissions } from './live-fixture.ts';
import { endpointFixture } from './gateway-metadata-fixture.ts';

const MODEL='openai/gpt-4.1-mini',SLUG='azure';
const req={schema_version:1 as const,request_id:'gateway_1',session_id:'session_1',prompt:'make louder'};
type Parameter=Snapshot['parameters'][number];
// Mirrors the experiment shape: one adjustable control among locked (min==max), boolean and topology controls.
const mixed:Parameter[]=[
 {stage_id:'compressor',parameter_id:'thresholdDb',unit:'dB',value:-18,min:-40,max:0},
 {stage_id:'compressor',parameter_id:'makeupDb',unit:'dB',value:0,min:0,max:0},
 {stage_id:'compressor',parameter_id:'ratio',unit:'ratio',value:4,min:4,max:4},
 {stage_id:'compressor',parameter_id:'compressor',unit:'boolean',value:true,min:0,max:1},
 {stage_id:'drive',parameter_id:'drive',unit:'dB',value:0,min:-6,max:6},
];
const snapshotOf=(parameters:Parameter[]):Snapshot=>({session_id:'session_1',session_revision:1,source_sha256:'a'.repeat(64),base_graph_sha256:'b'.repeat(64),source_handle:'opaque',selection_samples:[0,48000],sample_rate:48000,parameters});
const adapterFor=(parameters:Parameter[]):NativeAdapter=>({async snapshot(){return snapshotOf(parameters);},async measurements(){return [{measurement_id:'rms_dbfs',value:-24,unit:'dBFS'}];},
 async render(){return {preview_id:'preview_1',audio_sha256:'c'.repeat(64),session_revision:1,measurements:[{measurement_id:'preview_rms_dbfs',value:-18,unit:'dBFS'}]};},async compare(){return [{measurement_id:'rms_delta_db',value:6,unit:'dB'}];}});
const toolCall=(action:any)=>[{type:'tool-call' as const,toolCallId:'call_mock',toolName:action.kind,input:JSON.stringify(action.kind==='propose_change'?{preview_id:action.preview_id??'preview_1',proposal:(({parameter_patch,evidence_refs,...rest})=>({...rest,evidence_refs:evidence_refs.map((e:any)=>e.measurement_id)}))(action.proposal)}:(({kind,...rest})=>rest)(action))}];
const generated=(action:unknown,inputTokens=100)=>({content:toolCall(action),finishReason:{unified:'tool-calls' as const,raw:'tool_calls'},
 usage:{inputTokens:{total:inputTokens,noCache:inputTokens,cacheRead:0,cacheWrite:0},outputTokens:{total:50,text:50,reasoning:0}},providerMetadata:{gateway:{generationId:'gen_mock'}},response:{modelId:MODEL},warnings:[]});

type Json={[key:string]:unknown};
/** Checks the OpenAI/Azure strict subset: every object closed and fully required, root not a union, bounded depth. */
function assertStrictCompatible(schema:Json){
 assert.equal(schema.type,'object');assert.equal(schema.anyOf,undefined);
 const defs=(schema.$defs??{}) as Record<string,Json>;
 let maxDepth=0;
 (function walk(node:unknown,depth:number){
  if(Array.isArray(node)){node.forEach(n=>walk(n,depth));return;}
  if(!node||typeof node!=='object')return;
  const n=node as Json;
  if(typeof n.$ref==='string'){const name=/^#\/\$defs\/([a-z_]+)$/.exec(n.$ref)?.[1];assert.ok(name&&defs[name],n.$ref);walk(defs[name],depth);return;}
  for(const keyword of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','pattern','format','minLength','maxLength','minItems','maxItems','uniqueItems','prefixItems','oneOf','const','propertyNames','patternProperties'])
   assert.equal(keyword in n,false,keyword);
  if(n.type==='object'){
   const d=depth+1;maxDepth=Math.max(maxDepth,d);
   assert.equal(n.additionalProperties,false);
   assert.deepEqual([...(n.required as string[])].sort(),Object.keys(n.properties as Json).sort());
   for(const v of Object.values(n.properties as Json))walk(v,d);
   return;
  }
  if(n.items)walk(n.items,depth);
  if(n.anyOf)walk(n.anyOf,depth);
 })(Object.fromEntries(Object.entries(schema).filter(([k])=>k!=='$defs')),0);
 assert.ok(maxDepth<=5,`depth ${maxDepth}`);
 assert.ok(schemaPropertyCount(schema)<=PROVIDER_SCHEMA_MAX_PROPERTIES,String(schemaPropertyCount(schema)));
}
/** Every stage/parameter/unit triple a patch entry admits. */
function admittedTriples(schema:Json){
 const entry=(schema.$defs as {patch_entry:Json}).patch_entry;
 const entries=(entry.anyOf as Json[]|undefined)??[entry];
 return entries.flatMap(e=>{const p=e.properties as Record<string,{enum:string[]}>;
  return p.stage_id.enum.flatMap(s=>p.parameter_id.enum.flatMap(id=>p.unit.enum.map(u=>`${s}/${id}/${u}`)));}).sort();
}

test('Gateway request body carries strict tools, one required call, and adjustable controls only',async()=>{
 const fixture=endpointFixture(MODEL,SLUG);
 const policy={...livePolicy(),verified_model:MODEL,provider_slug:SLUG,metadata_sha256:endpointMetadataDigest(fixture,MODEL,SLUG)};
 const bodies:Json[]=[];
 const fakeFetch=(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url==='https://ai-gateway.vercel.sh/v4/ai/config')return Response.json({models:[{id:MODEL,name:MODEL,pricing:{input:'0.000001',output:'0.000001'},specification:{specificationVersion:'v4',provider:SLUG,modelId:MODEL},modelType:'language'}]});
  if(url===`https://ai-gateway.vercel.sh/v1/models/${MODEL}/endpoints`)return Response.json(fixture);
  if(url==='https://ai-gateway.vercel.sh/v4/ai/language-model'){bodies.push(JSON.parse(String(init?.body)));
   return Response.json(generated(bodies.length===1?{kind:'render_candidate',parameter_patch:[{stage_id:'compressor',parameter_id:'thresholdDb',unit:'dB',value:-24}]}:{kind:'abstain',reason:'Not met.'}));}
  throw Error('unexpected_url '+url);
 }) as typeof fetch;
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-body-'));
 try{
  const result=await new AssistantService(adapterFor(mixed),new StateStore(directory),new GatewayProvider(policy,'mock-key',{fetch:fakeFetch}),policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);
  assert.equal(result.status,'abstain',JSON.stringify(result));
  assert.equal(bodies.length,2);
  // The first turn offers render, noop and abstain; after a render, propose_change replaces noop.
  assert.deepEqual((bodies[0].tools as Array<{name:string}>).map(t=>t.name),['render_candidate','noop','abstain']);
  const first=JSON.parse(((bodies[0].prompt as Array<{role:string;content:Array<{type:string;text?:string}>}>).find(m=>m.role==='user')!.content[0].text)!);
  assert.equal(first.renders_left,2);
  const body=bodies[1];
  // The Gateway client forwards the call options unchanged: each tool carries its own strict flag.
  assert.deepEqual((body.providerOptions as Json).openai,{parallelToolCalls:false});
  assert.deepEqual(((body.providerOptions as Json).gateway as Json).only,[SLUG]);
  assert.deepEqual(((body.providerOptions as Json).gateway as Json).has,['tool-use']);
  assert.notEqual((body.responseFormat as Json|undefined)?.type,'json');
  assert.deepEqual(body.toolChoice,{type:'required'});
  const tools=body.tools as Array<{type:string;name:string;strict:boolean;inputSchema:Json}>;
  assert.deepEqual(tools.map(t=>t.name),['render_candidate','compare_candidate','propose_change','abstain']);
  for(const t of tools){assert.equal(t.type,'function');assert.equal(t.strict,true,t.name);assertStrictCompatible(t.inputSchema);}
  const byName=Object.fromEntries(tools.map(t=>[t.name,t.inputSchema]));
  assert.deepEqual(admittedTriples(byName.render_candidate),['compressor/thresholdDb/dB']);
  assert.deepEqual(((byName.render_candidate.properties as Json).parameter_patch as Json).items,{$ref:'#/$defs/patch_entry'});
  // propose_change names the rendered preview; its patch is copied from that preview, so no patch schema is sent twice.
  assert.deepEqual(Object.keys(byName.propose_change.properties as Json),['preview_id','proposal']);
  assert.ok(!JSON.stringify(byName.propose_change).includes('parameter_patch'));
  assert.equal(byName.propose_change.$defs,undefined);
  // Evidence is named by baseline measurement id; the value range of each control is stated where it is chosen.
  assert.deepEqual(((byName.propose_change.properties as Json).proposal as {properties:Json}).properties.evidence_refs,{type:'array',items:{type:'string',enum:['rms_dbfs']}});
  assert.equal(JSON.stringify(byName.render_candidate.$defs).includes('"description":"thresholdDb -40 to 0"'),true);
  const tool=(bodies[1].prompt as Array<{role:string;content:Array<{type:string;output?:{value?:{renders_left?:number}}}>}>).find(m=>m.role==='tool');
  assert.equal(tool?.content[0].output?.value?.renders_left,1);
  for(const locked of ['makeupDb','"ratio"','"drive"','boolean'])assert.ok(!JSON.stringify(byName.render_candidate.$defs).includes(locked),locked);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('input reservation counts exactly the per-request tool definitions that are sent',async()=>{
 for(const [extra,expected] of [[0,'noop'],[1,'provider_usage_exceeded_reservation']] as const){
  const policy={...livePolicy(),verified_model:MODEL,provider_slug:SLUG};
  const model=new MockLanguageModelV4({modelId:MODEL,doGenerate:async options=>{
   const system=options.prompt.find(m=>m.role==='system');const user=options.prompt.find(m=>m.role==='user');
   assert.ok(system&&typeof system.content==='string'&&user&&Array.isArray(user.content)&&user.content[0].type==='text');
   const tools=(options.tools??[]) as Array<{name:string;inputSchema:unknown}>;
   assert.deepEqual(tools.map(t=>t.name),['render_candidate','noop','abstain']);
   const toolText=JSON.stringify(Object.fromEntries(tools.map(t=>[t.name,t.inputSchema])));
   const bound=Buffer.byteLength(system.content+toolText)+Buffer.byteLength(JSON.stringify([{role:'user',content:user.content[0].text}]))+512;
   return generated({kind:'noop',reason:'done'},bound+extra);
  }});
  const directory=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-bound-'));
  try{
   const result=await new AssistantService(adapterFor(mixed),new StateStore(directory),new GatewayProvider(policy,'mock',{model,async verifyMetadata(){}}),policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);
   assert.equal(expected==='noop'?result.status:result.reason,expected,JSON.stringify(result));
  }finally{await rm(directory,{recursive:true,force:true});}
 }
});

test('with no adjustable control only noop or abstain is offered, and a patch is still rejected by the service',async()=>{
 const locked=mixed.filter(p=>p.parameter_id!=='thresholdDb');
 assert.deepEqual(adjustableControls(snapshotOf(locked)),[]);
 const schema=providerSchemaFor([]) as Json;
 assertStrictCompatible(schema);
 const action=(schema.properties as Json).action as Json;
 assert.equal(action.anyOf,undefined);
 assert.deepEqual(Object.keys(action.properties as Json),['kind','reason']);
 assert.deepEqual(((action.properties as Json).kind as Json).enum,['noop','abstain']);
 assert.ok(!JSON.stringify(schema).includes('parameter_patch'));
 // The Zod action contract and service patch validation are unchanged safety nets.
 const policy={...livePolicy(),verified_model:MODEL,provider_slug:SLUG};
 for(const [parameters,patch,reason] of [
  // With no adjustable control there is no render tool, so the call is rejected as an unknown tool.
  [locked,{stage_id:'compressor',parameter_id:'makeupDb',unit:'dB',value:3},'provider_output_schema_invalid_accounting_reserved'],
  [mixed,{stage_id:'compressor',parameter_id:'thresholdDb',unit:'dB',value:12},'unauthorized_parameter'],
  [mixed,{stage_id:'compressor',parameter_id:'thresholdDb',unit:'ratio',value:-6},'unauthorized_parameter'],
 ] as const){
  const model=new MockLanguageModelV4({modelId:MODEL,doGenerate:generated({kind:'render_candidate',parameter_patch:[patch]})});
  const directory=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-locked-'));
  try{
   const result=await new AssistantService(adapterFor([...parameters]),new StateStore(directory),new GatewayProvider(policy,'mock',{model,async verifyMetadata(){}}),policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);
   assert.equal(result.status,'failed');assert.equal(result.reason,reason);assert.equal(model.doGenerateCalls.length,1);
  }finally{await rm(directory,{recursive:true,force:true});}
 }
});

test('exact control triples are grouped by stage and unit, and fall back to per-field enums past the property limit',()=>{
 const controls=adjustableControls(snapshotOf([
  {stage_id:'compressor',parameter_id:'thresholdDb',unit:'dB',value:-18,min:-40,max:0},
  {stage_id:'compressor',parameter_id:'kneeDb',unit:'dB',value:0,min:0,max:12},
  {stage_id:'compressor',parameter_id:'attackMs',unit:'ms',value:10,min:1,max:100},
  {stage_id:'output',parameter_id:'outputDb',unit:'dB',value:0,min:-24,max:24},
  {stage_id:'output',parameter_id:'outputDb',unit:'dB',value:0,min:-24,max:24},
 ]));
 const schema=providerSchemaFor(controls) as Json;
 assertStrictCompatible(schema);
 assert.deepEqual(admittedTriples(schema),['compressor/attackMs/ms','compressor/kneeDb/dB','compressor/thresholdDb/dB','output/outputDb/dB']);
 const many=Array.from({length:40},(_,i)=>({stage_id:'stage'+i,parameter_id:'gain'+i+'Db',unit:'dB'}));
 const large=providerSchemaFor(many) as Json;
 assertStrictCompatible(large);
 const entry=(large.$defs as {patch_entry:Json}).patch_entry;
 assert.equal(entry.anyOf,undefined);
 assert.deepEqual(((entry.properties as Json).stage_id as Json).enum,many.map(c=>c.stage_id));
});

test('propose_change takes the named preview patch, and an unrendered preview is still rejected',async()=>{
 const patch={stage_id:'compressor',parameter_id:'thresholdDb',unit:'dB' as const,value:-24};
 const proposal={schema_version:1,request_id:'gateway_1',session_revision:1,source_sha256:'a'.repeat(64),base_graph_sha256:'b'.repeat(64),selection_samples:[0,48000],
  hypotheses:['A lower threshold reduces the louder passage.'],evidence_refs:[{measurement_id:'rms_dbfs',value:-24,unit:'dBFS'}],
  expected_tradeoffs:['Less dynamic range.'],limitations:['Measured RMS only.'],requires_user_acceptance:true};
 const policy={...livePolicy(),verified_model:MODEL,provider_slug:SLUG};
 for(const [preview_id,expected] of [['preview_1','ready'],['preview_9','evaluated_preview_required']] as const){
  const model=new MockLanguageModelV4({modelId:MODEL,doGenerate:[generated({kind:'render_candidate',parameter_patch:[patch]}),
   generated({kind:'propose_change',preview_id,proposal:{...proposal,parameter_patch:[{...patch,value:-40}]}})]});
  const directory=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-propose-'));
  try{
   const result=await new AssistantService(adapterFor(mixed),new StateStore(directory),new GatewayProvider(policy,'mock',{model,async verifyMetadata(){}}),policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);
   assert.equal(result.status==='ready'?'ready':result.reason,expected,JSON.stringify(result));
   assert.equal(model.doGenerateCalls.length,2);
   // The mock's own patch value is never sent; the proposal carries exactly the rendered patch.
   if(expected==='ready')assert.deepEqual(result.proposal?.parameter_patch,[patch]);
   else assert.equal(result.authorization?.accounting_known,true);
  }finally{await rm(directory,{recursive:true,force:true});}
 }
});

test('after two renders no further render is offered, so a proposal always fits the call limit',async()=>{
 const patch=(value:number)=>[{stage_id:'compressor',parameter_id:'thresholdDb',unit:'dB' as const,value}];
 const policy={...livePolicy(),verified_model:MODEL,provider_slug:SLUG};
 const model=new MockLanguageModelV4({modelId:MODEL,doGenerate:[generated({kind:'render_candidate',parameter_patch:patch(-12)}),
  generated({kind:'render_candidate',parameter_patch:patch(-24)}),generated({kind:'abstain',reason:'Not met.'})]});
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-budget-'));
 try{
  // Each render needs its own preview id; the shared fixture returns one fixed id.
  let renders=0;const base=adapterFor(mixed);
  const native:NativeAdapter={...base,async render(){renders++;return {preview_id:'preview_'+renders,audio_sha256:'c'.repeat(64),session_revision:1,measurements:[{measurement_id:'preview_rms_dbfs',value:-18,unit:'dBFS'}]};}};
  const result=await new AssistantService(native,new StateStore(directory),new GatewayProvider(policy,'mock',{model,async verifyMetadata(){}}),policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);
  assert.equal(result.status,'abstain',JSON.stringify(result));
  const names=model.doGenerateCalls.map(call=>(call.tools??[]).map(t=>t.name));
  assert.deepEqual(names,[['render_candidate','noop','abstain'],['render_candidate','compare_candidate','propose_change','abstain'],['compare_candidate','propose_change','abstain']]);
  const left=model.doGenerateCalls[2].prompt.filter(m=>m.role==='tool').map(m=>(m.content[0] as unknown as {output:{value:{renders_left:number}}}).output.value.renders_left);
  assert.deepEqual(left,[1,0]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
