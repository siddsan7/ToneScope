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
const generated=(action:unknown,inputTokens=100)=>({content:[{type:'text' as const,text:JSON.stringify({action})}],finishReason:{unified:'stop' as const,raw:'stop'},
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

test('Gateway request body carries strict structured output and a per-request schema of adjustable controls only',async()=>{
 const fixture=endpointFixture(MODEL,SLUG);
 const policy={...livePolicy(),verified_model:MODEL,provider_slug:SLUG,metadata_sha256:endpointMetadataDigest(fixture,MODEL,SLUG)};
 const bodies:Json[]=[];
 const fakeFetch=(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url==='https://ai-gateway.vercel.sh/v4/ai/config')return Response.json({models:[{id:MODEL,name:MODEL,pricing:{input:'0.000001',output:'0.000001'},specification:{specificationVersion:'v4',provider:SLUG,modelId:MODEL},modelType:'language'}]});
  if(url===`https://ai-gateway.vercel.sh/v1/models/${MODEL}/endpoints`)return Response.json(fixture);
  if(url==='https://ai-gateway.vercel.sh/v4/ai/language-model'){bodies.push(JSON.parse(String(init?.body)));return Response.json(generated({kind:'noop',reason:'No change required.'}));}
  throw Error('unexpected_url '+url);
 }) as typeof fetch;
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-body-'));
 try{
  const result=await new AssistantService(adapterFor(mixed),new StateStore(directory),new GatewayProvider(policy,'mock-key',{fetch:fakeFetch}),policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);
  assert.equal(result.status,'noop',JSON.stringify(result));
  assert.equal(bodies.length,1);
  const body=bodies[0];
  // The Gateway client forwards the call options unchanged; strictness is decided by the routed OpenAI/Azure
  // adapter, which reads it from providerOptions.openai.strictJsonSchema.
  assert.deepEqual((body.providerOptions as Json).openai,{strictJsonSchema:true});
  assert.deepEqual(((body.providerOptions as Json).gateway as Json).only,[SLUG]);
  const format=body.responseFormat as Json;
  assert.deepEqual(Object.keys(format).sort(),['schema','type']);
  assert.equal(format.type,'json');
  const schema=format.schema as Json;
  assertStrictCompatible(schema);
  assert.deepEqual(admittedTriples(schema),['compressor/thresholdDb/dB']);
  const branches=((schema.properties as Json).action as {anyOf:Array<{properties:Json}>}).anyOf;
  assert.deepEqual(branches.map(b=>Object.keys(b.properties)[0]),['kind','kind','kind','kind']);
  assert.deepEqual((branches[0].properties.parameter_patch as Json).items,{$ref:'#/$defs/patch_entry'});
  assert.deepEqual((((branches[2].properties.proposal as Json).properties as Json).parameter_patch as Json).items,{$ref:'#/$defs/patch_entry'});
  for(const locked of ['makeupDb','"ratio"','"drive"','boolean'])assert.ok(!JSON.stringify(schema.$defs).includes(locked),locked);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('input reservation counts exactly the per-request schema text that is sent',async()=>{
 for(const [extra,expected] of [[0,'noop'],[1,'provider_usage_exceeded_reservation']] as const){
  const policy={...livePolicy(),verified_model:MODEL,provider_slug:SLUG};
  const model=new MockLanguageModelV4({modelId:MODEL,doGenerate:async options=>{
   const system=options.prompt.find(m=>m.role==='system');const user=options.prompt.find(m=>m.role==='user');
   assert.ok(system&&typeof system.content==='string'&&user&&Array.isArray(user.content)&&user.content[0].type==='text');
   assert.ok(options.responseFormat?.type==='json'&&options.responseFormat.schema);
   const bound=Buffer.byteLength(system.content+JSON.stringify(options.responseFormat.schema))+Buffer.byteLength(JSON.stringify([{role:'user',content:user.content[0].text}]))+512;
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
 for(const [parameters,patch] of [
  [locked,{stage_id:'compressor',parameter_id:'makeupDb',unit:'dB',value:3}],
  [mixed,{stage_id:'compressor',parameter_id:'thresholdDb',unit:'dB',value:12}],
  [mixed,{stage_id:'compressor',parameter_id:'thresholdDb',unit:'ratio',value:-6}],
 ] as const){
  const model=new MockLanguageModelV4({modelId:MODEL,doGenerate:generated({kind:'render_candidate',parameter_patch:[patch]})});
  const directory=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-locked-'));
  try{
   const result=await new AssistantService(adapterFor([...parameters]),new StateStore(directory),new GatewayProvider(policy,'mock',{model,async verifyMetadata(){}}),policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);
   assert.equal(result.status,'failed');assert.equal(result.reason,'unauthorized_parameter');assert.equal(model.doGenerateCalls.length,1);
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
