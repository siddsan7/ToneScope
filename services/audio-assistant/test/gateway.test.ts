import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { GatewayProvider } from '../agent/lib/gateway-provider.ts';
import { AssistantService,type LivePolicy } from '../agent/lib/service.ts';
import { StateStore } from '../agent/lib/store.ts';
import {consentDigest,jsonDigest} from '../agent/lib/live-policy.ts';
import type { NativeAdapter,Proposal } from '../agent/lib/contracts.ts';
import {livePolicy,defaultAdmissions} from './live-fixture.ts';
import {AdmissionGuard,admissionsDigest,promptDigest} from '../agent/lib/live-admission.ts';
const policy={...livePolicy(),verified_model:'openai/gpt-6-luna-fast',provider_slug:'openai'};
const req={schema_version:1,request_id:'gateway_1',session_id:'session_1',prompt:'make louder'};
const proposal:Proposal={schema_version:1,request_id:'gateway_1',session_revision:1,source_sha256:'a'.repeat(64),base_graph_sha256:'b'.repeat(64),selection_samples:[0,48000],hypotheses:['A bounded gain change may improve measured level.'],evidence_refs:[{measurement_id:'rms_dbfs',value:-24,unit:'dBFS'}],parameter_patch:[{stage_id:'output',parameter_id:'outputDb',unit:'dB',value:6}],expected_tradeoffs:['Less peak headroom.'],limitations:['No listening or perceptual qualification.'],requires_user_acceptance:true};
const adapter:NativeAdapter={async snapshot(){return {session_id:'session_1',session_revision:1,source_sha256:'a'.repeat(64),base_graph_sha256:'b'.repeat(64),source_handle:'opaque',selection_samples:[0,48000],sample_rate:48000,parameters:[{stage_id:'output',parameter_id:'outputDb',unit:'dB',value:0,min:-24,max:24}]};},async measurements(){return [{measurement_id:'rms_dbfs',value:-24,unit:'dBFS'}];},async render(){return {preview_id:'preview_1',audio_sha256:'c'.repeat(64),session_revision:1,measurements:[{measurement_id:'preview_rms_dbfs',value:-18,unit:'dBFS'}]};},async compare(){return [{measurement_id:'rms_delta_db',value:6,unit:'dB'}];}};
// The provider answers with one tool call named by the action kind; its input is the rest of the action.
const toolCall=(action:any)=>[{type:'tool-call' as const,toolCallId:'call_mock',toolName:action.kind,input:JSON.stringify(action.kind==='propose_change'?{preview_id:action.preview_id??'preview_1',proposal:(({parameter_patch,evidence_refs,...rest})=>({...rest,evidence_refs:evidence_refs.map((e:any)=>e.measurement_id)}))(action.proposal)}:(({kind,...rest})=>rest)(action))}];
const response=(action:unknown)=>({content:action?toolCall(action):[],finishReason:{unified:'tool-calls' as const,raw:'tool_calls'},usage:{inputTokens:{total:100,noCache:100,cacheRead:0,cacheWrite:0},outputTokens:{total:50,text:50,reasoning:0}},providerMetadata:{gateway:{generationId:'gen_mock'}},response:{modelId:policy.verified_model},warnings:[]});

test('Gateway classifies SDK output failures without retaining response text', async () => {
 const privateText = 'PRIVATE_DIAGNOSTIC_CANARY';
 // Each case is the second reply's content. A tool call's input is the raw argument text the provider sent.
 const call=(toolName:string,input:string,toolCallId='call_2')=>({type:'tool-call' as const,toolCallId,toolName,input});
 const cases = [
  {content:[], finish:'stop', reason:'provider_output_schema_invalid_accounting_reserved'},
  {content:[{type:'text' as const,text:JSON.stringify({action:{kind:'noop',reason:privateText}})}], finish:'stop', reason:'provider_output_schema_invalid_accounting_reserved'},
  {content:[], finish:'length', reason:'provider_output_truncated_accounting_reserved'},
  {content:[call('abstain','{"reason":"'+privateText)], finish:'length', reason:'provider_output_truncated_accounting_reserved'},
  {content:[call('abstain','{"reason":'+privateText)], finish:'tool-calls', reason:'provider_output_json_invalid_accounting_reserved'},
  {content:[call('abstain',JSON.stringify({reason:'',extra:privateText}))], finish:'tool-calls', reason:'provider_output_schema_invalid_accounting_reserved'},
  {content:[call('abstain',JSON.stringify({reason:privateText}),'call_a'),call('abstain',JSON.stringify({reason:privateText}),'call_b')], finish:'tool-calls', reason:'provider_output_schema_invalid_accounting_reserved'},
  {content:[call('get_session_snapshot',JSON.stringify({[privateText]:1}))], finish:'tool-calls', reason:'provider_output_schema_invalid_accounting_reserved'},
 ] as const;
 // Content-free shape facts expected for each JSON/schema failure, in case order. A reply without a tool call keeps no text.
 const shapes=new Map<number,object>([
  [0,{byte_length:0,top_level_json_values:0,finish_reason:'stop'}],
  [1,{byte_length:0,top_level_json_values:0,finish_reason:'stop'}],
  [4,{starts_with_brace:true,ends_with_brace:false,has_code_fence:false,top_level_json_values:0,finish_reason:'tool-calls'}],
  [5,{starts_with_brace:true,ends_with_brace:true,has_code_fence:false,top_level_json_values:1,trailing_unparsed_bytes:0,finish_reason:'tool-calls'}],
  [6,{starts_with_brace:true,ends_with_brace:true,has_code_fence:false,top_level_json_values:2,trailing_unparsed_bytes:0,finish_reason:'tool-calls'}],
  [7,{starts_with_brace:true,ends_with_brace:true,top_level_json_values:1,finish_reason:'tool-calls'}],
 ]);
 for (const [index, {content, finish, reason}] of cases.entries()) {
  const directory = await mkdtemp(join(process.cwd(), '.test-runtime-gateway-diagnostic-'));
  try {
   const model = new MockLanguageModelV4({modelId:policy.verified_model, doGenerate:[
    response({kind:'render_candidate',parameter_patch:proposal.parameter_patch}),
    {...response(null), content:[...content], finishReason:{unified:finish,raw:finish}},
   ]});
   const provider = new GatewayProvider(policy, 'mock', {model, async verifyMetadata(){}});
   const result = await new AssistantService(adapter, new StateStore(directory), provider, policy,
    undefined, undefined, new AdmissionGuard(defaultAdmissions)).run(req);
   assert.equal(result.status,'failed');
   assert.equal(result.reason,reason);
   assert.equal(result.preview,null);
   assert.equal(result.authorization?.accounting_known,false);
   assert.equal(model.doGenerateCalls.length,2);
   assert.equal(result.trace?.events.filter(event=>event.category==='generation_start').length,2);
   assert.equal(result.trace?.events.at(-1)?.category,'terminal');
   assert.ok(!JSON.stringify(result).includes(privateText));
   const diagnostic=provider.lastOutputDiagnostic;
   if(shapes.has(index)){
    assert.equal(diagnostic?.request_id,req.request_id);assert.equal(diagnostic?.generation,2);
    for(const [key,value] of Object.entries(shapes.get(index)!))assert.equal((diagnostic as Record<string,unknown>)[key],value,`${index} ${key}`);
    assert.equal(diagnostic?.category,reason.includes('schema')?'schema_invalid':'json_invalid');
    if(diagnostic?.category==='schema_invalid')assert.ok(diagnostic.schema_issues.length>0&&diagnostic.schema_issues.every(i=>/^[a-z_]+$/.test(i.code)&&i.path.every(p=>typeof p==='number'||/^[a-z0-9_?]+$/.test(p))));
    else assert.deepEqual(diagnostic?.schema_issues,[]);
    const exposed=JSON.stringify(diagnostic);
    for(const forbidden of [privateText,'extra','noop','abstain','get_session_snapshot','```',policy.verified_model,'make louder'])assert.ok(!exposed.includes(forbidden),forbidden);
   }else assert.equal(diagnostic,undefined);
   const ledgerText = await readFile(join(directory,'budget-v2.json'),'utf8');
   assert.ok(!ledgerText.includes(privateText));
   const ledger=JSON.parse(ledgerText);
   assert.equal(ledger.committed,result.authorization?.reserved_usd);
   assert.equal(ledger.generations,2);
  } finally {
   await rm(directory,{recursive:true,force:true});
  }
 }
});
test('dormant Gateway adapter executes real SDK strict-output protocol with metered usage and bounded native tools using a mock SDK model',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));try{const model=new MockLanguageModelV4({modelId:policy.verified_model,doGenerate:[response({kind:'render_candidate',parameter_patch:proposal.parameter_patch}),response({kind:'propose_change',proposal})]});let verified=0;const provider=new GatewayProvider(policy,'mock-credential-never-sent',{model,async verifyMetadata(){verified++;}});const result=await new AssistantService(adapter,new StateStore(dir),provider,policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);assert.equal(result.status,'ready',JSON.stringify(result));assert.equal(verified,1);assert.equal(model.doGenerateCalls.length,2);assert.equal(result.usage.input_tokens,200);assert.equal(result.usage.output_tokens,100);assert.ok(Math.abs(result.usage.cost_usd-0.0003)<1e-12);assert.equal(result.usage.tool_calls,5);assert.deepEqual(model.doGenerateCalls[0].toolChoice,{type:'required'});assert.equal(model.doGenerateCalls[0].maxOutputTokens,2048);assert.ok(!JSON.stringify(model.doGenerateCalls).includes('source_path'));assert.ok(!JSON.stringify(model.doGenerateCalls).includes('mock-credential'));}finally{await rm(dir,{recursive:true,force:true});}});
test('malformed provider output is rejected without retry and preserves worst-case billable reservation',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));try{const model=new MockLanguageModelV4({modelId:policy.verified_model,doGenerate:response({kind:'render_candidate',parameter_patch:proposal.parameter_patch,shell:'bad'})});const provider=new GatewayProvider(policy,'mock',{model,async verifyMetadata(){}});const result=await new AssistantService(adapter,new StateStore(dir),provider,policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);assert.equal(result.status,'failed');assert.equal(model.doGenerateCalls.length,1);assert.equal(result.preview,null);assert.ok(result.usage.cost_usd>0);assert.ok(result.usage.input_tokens>0);}finally{await rm(dir,{recursive:true,force:true});}});
test('metadata failure and stale pricing block every model attempt',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));try{const model=new MockLanguageModelV4({doGenerate:response({kind:'abstain',reason:'mock'})});const provider=new GatewayProvider(policy,'mock',{model,async verifyMetadata(){throw Error('provider_snapshot_or_pricing_changed');}});assert.equal((await new AssistantService(adapter,new StateStore(dir),provider,policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req)).status,'failed');assert.equal(model.doGenerateCalls.length,0);const stale={...policy,verified_at:'2000-01-01T00:00:00Z'};assert.equal((await new AssistantService(adapter,new StateStore(dir),provider,stale,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run({...req,request_id:'gateway_2'})).reason,'live_not_authorized');assert.equal(model.doGenerateCalls.length,0);}finally{await rm(dir,{recursive:true,force:true});}});
test('currency budget ledger survives service recreation and cannot overspend',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));try{const store=new StateStore(dir);await store.updateBudget(0.02,0.019);await assert.rejects(new StateStore(dir).updateBudget(0.02,0.002),/currency_budget_exhausted/);await store.updateBudget(0.02,-0.01);await new StateStore(dir).updateBudget(0.02,0.005);}finally{await rm(dir,{recursive:true,force:true});}});
test('provider consent identity mismatch blocks before any model or metadata call',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));try{let verified=0;const model=new MockLanguageModelV4({doGenerate:response({kind:'noop',reason:'done'})});const provider=new GatewayProvider(policy,'mock',{model,async verifyMetadata(){verified++;}});const out=await new AssistantService(adapter,new StateStore(dir),provider,{...policy,provider_slug:'other'}).run(req);assert.equal(out.reason,'provider_consent_mismatch');assert.equal(verified,0);assert.equal(model.doGenerateCalls.length,0);}finally{await rm(dir,{recursive:true,force:true});}});
test('settlement failure releases durable and local admission while retaining unknown funds',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));try{const store=new StateStore(dir);store.settleLive=async()=>{throw Error('injected_settlement_failure');};const p={kind:'live' as const,consent_sha256:consentDigest(policy),async run(_r:unknown,t:import('../agent/lib/service.ts').RequestTools){await t.beforeGeneration();t.accountingKnown=true;t.usage.cost_usd=.001;return {status:'noop' as const,reason:'done'};}};const service=new AssistantService(adapter,store,p,policy,undefined,undefined,new AdmissionGuard(defaultAdmissions));await assert.rejects(service.run(req),/injected_settlement_failure/);await assert.rejects(service.run({...req,request_id:'next'}),/injected_settlement_failure/);}finally{await rm(dir,{recursive:true,force:true});}});
test('fault-injected SDK trace is ordered, bound, bounded, and excludes credentials and prompt',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));try{const model=new MockLanguageModelV4({modelId:policy.verified_model,doGenerate:response({kind:'noop',reason:'done'})});const out=await new AssistantService(adapter,new StateStore(dir),new GatewayProvider(policy,'private_mock_key',{model,async verifyMetadata(){}}),policy,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);assert.equal(out.authorization?.provenance,'fault-injected');assert.equal(out.trace?.attempt_id,req.request_id);assert.equal(out.trace?.events.find(e=>e.category==='generation_end')?.provider_response_id,'gen_mock');const ledger=JSON.parse(await readFile(join(dir,'budget-v2.json'),'utf8'));assert.equal((Object.values(ledger.records)[0] as {binding:{request_sha256:string}}).binding.request_sha256,jsonDigest(req));assert.deepEqual(out.trace?.events.map(e=>e.sequence),out.trace?.events.map((_,i)=>i+1));assert.equal(out.trace?.events.at(-1)?.category,'terminal');assert.equal(out.snapshots?.length,1);const trace=JSON.stringify(out.trace);assert.ok(!trace.includes('private_mock_key'));assert.ok(!trace.includes(req.prompt));assert.ok(Buffer.byteLength(JSON.stringify(out))<65536);}finally{await rm(dir,{recursive:true,force:true});}});
test('live cancellation keeps full durable reservation and late usage cannot alter terminal envelope or ledger',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));let started:()=>void=()=>{},resume:()=>void=()=>{};const barrier=new Promise<void>(r=>started=r);try{const provider={kind:'live' as const,consent_sha256:consentDigest(policy),async run(_r:unknown,t:import('../agent/lib/service.ts').RequestTools){await t.beforeGeneration();started();await new Promise<void>(r=>resume=r);t.usage.cost_usd=.0001;t.usage.input_tokens=1;t.accountingKnown=true;return {status:'noop' as const,reason:'late'};}};const service=new AssistantService(adapter,new StateStore(dir),provider,policy,undefined,undefined,new AdmissionGuard(defaultAdmissions));const pending=service.run(req);await barrier;service.cancel(req.session_id,req.request_id);const out=await pending;assert.equal(out.status,'canceled');assert.equal(out.usage.cost_usd,.016);assert.equal(out.authorization?.accounting_known,false);const exported=JSON.stringify(out),ledger=await readFile(join(dir,'budget-v2.json'),'utf8');resume();await new Promise(r=>setImmediate(r));assert.equal(JSON.stringify(out),exported);assert.equal(await readFile(join(dir,'budget-v2.json'),'utf8'),ledger);}finally{await rm(dir,{recursive:true,force:true});}});
test('settlement persistence failure releases evaluated preview as well as active admission',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));try{let released=0;const native={...adapter,async releasePreview(){released++;}};const store=new StateStore(dir);store.settleLive=async()=>{throw Error('injected_ledger_failure');};const model=new MockLanguageModelV4({modelId:policy.verified_model,doGenerate:[response({kind:'render_candidate',parameter_patch:proposal.parameter_patch}),response({kind:'propose_change',proposal})]});const service=new AssistantService(native,store,new GatewayProvider(policy,'mock',{model,async verifyMetadata(){}}),policy,undefined,undefined,new AdmissionGuard(defaultAdmissions));await assert.rejects(service.run(req),/injected_ledger_failure/);assert.equal(released,1);const ledger=JSON.parse(await readFile(join(dir,'budget-v2.json'),'utf8'));assert.equal(Object.values(ledger.records).every((r:any)=>r.owner===null),true);assert.equal(ledger.committed,.016);}finally{await rm(dir,{recursive:true,force:true});}});
test('next-generation admission failure cannot label a new reservation as authoritative usage',async()=>{const dir=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-'));try{const p={...policy,max_generations:1};const model=new MockLanguageModelV4({modelId:policy.verified_model,doGenerate:response({kind:'render_candidate',parameter_patch:proposal.parameter_patch})});const out=await new AssistantService(adapter,new StateStore(dir),new GatewayProvider(p,'mock',{model,async verifyMetadata(){}}),p,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run(req);assert.equal(out.reason,'generation_budget_exhausted');assert.equal(model.doGenerateCalls.length,1);assert.equal(out.authorization?.accounting_known,false);assert.equal(out.usage.cost_usd,.016);}finally{await rm(dir,{recursive:true,force:true});}});

test('Gateway sends Azure one strict tool per action kind, requires one call, and keeps a single items schema for selections', async () => {
 const directory = await mkdtemp(join(process.cwd(), '.test-runtime-gateway-schema-'));
 try {
  const model = new MockLanguageModelV4({
   modelId: policy.verified_model, doGenerate: [response({kind:'render_candidate',parameter_patch:proposal.parameter_patch}),response({kind:'abstain',reason:'Not met.'})]
  });
  const provider = new GatewayProvider(policy, 'mock', {model, async verifyMetadata(){}});
  const result = await new AssistantService(adapter, new StateStore(directory), provider, policy,
   undefined, undefined, new AdmissionGuard(defaultAdmissions)).run(req);
  assert.equal(result.status, 'abstain');
  // Only tools that can still lead to a valid answer are offered: noop before any render, propose_change after one.
  const names = (call: (typeof model.doGenerateCalls)[number]) => (call.tools ?? []).map(t => t.name);
  assert.deepEqual(names(model.doGenerateCalls[0]), ['render_candidate','noop','abstain']);
  assert.deepEqual(names(model.doGenerateCalls[1]), ['render_candidate','compare_candidate','propose_change','abstain']);
  const options = model.doGenerateCalls[1];
  // Several complete actions in one JSON reply were observed under strict structured output; a tool call is one action.
  assert.equal(options.responseFormat?.type ?? 'text', 'text');
  assert.deepEqual(options.toolChoice, {type:'required'});
  const tools = (options.tools ?? []) as Array<{type:string;name:string;strict?:boolean;inputSchema:Record<string,any>}>;
  for (const t of tools) {
   assert.equal(t.type, 'function'); assert.equal(t.strict, true, t.name);
   assert.equal(t.inputSchema.additionalProperties, false, t.name);
   assert.ok(!('kind' in (t.inputSchema.properties ?? {})), t.name);
   assert.doesNotMatch(JSON.stringify(t.inputSchema), /"(oneOf|prefixItems|minimum|maximum|exclusiveMinimum|exclusiveMaximum|minItems|maxItems|minLength|maxLength|pattern)":/);
  }
  const system = options.prompt.find(message => message.role === 'system');
  assert.ok(system && typeof system.content === 'string');
  for (const kind of ['render_candidate', 'propose_change', 'noop', 'abstain']) assert.match(system.content, new RegExp(kind + ' (tries|is the final answer)'));
  const selection = tools.find(t=>t.name==='propose_change')?.inputSchema.properties?.proposal?.properties?.selection_samples;
  assert.ok(selection && typeof selection === 'object' && 'items' in selection);
  assert.equal(Array.isArray(selection.items), false,
   "Azure rejects the draft-07 tuple 'items' array as neither an object nor a boolean");
  assert.deepEqual(selection.items, {type:'integer'});
 } finally {
  await rm(directory, {recursive:true, force:true});
 }
});
test('Gateway still rejects malformed selection bounds returned under the provider schema', async () => {
 for (const selection_samples of [[0], [0, 48000, 96000], [48000, 0]]) {
  const directory = await mkdtemp(join(process.cwd(), '.test-runtime-gateway-selection-'));
  try {
   const model = new MockLanguageModelV4({
    modelId: policy.verified_model,
    doGenerate: response({kind:'propose_change',proposal:{...proposal,selection_samples}}),
   });
   const provider = new GatewayProvider(policy, 'mock', {model, async verifyMetadata(){}});
   const result = await new AssistantService(adapter, new StateStore(directory), provider, policy,
    undefined, undefined, new AdmissionGuard(defaultAdmissions)).run(req);
   assert.equal(result.status, 'failed');
   assert.equal(result.preview, null);
   assert.equal(model.doGenerateCalls.length, 1);
   assert.equal(result.authorization?.accounting_known, false);
  } finally {
   await rm(directory, {recursive:true, force:true});
  }
 }
});

// Measures the reservation headroom of a realistic request. The first call is
// reserved at its UTF-8 byte count (bytes >= tokens); later calls charge the
// unchanged prefix at the provider-reported count and only appended messages at
// their byte count. The mock reports one token per three prompt bytes.
// Change these counts only with a reviewed bound.
test('incremental reservation admits more generations for realistic requests',async()=>{
 const prompt='Reduce the hard-soft RMS contrast by 3 dB while preserving the soft passage level and keeping sample peak below -1 dBFS.';
 const admissions=[{request_id:'headroom_1',prompt_sha256:promptDigest(prompt),role:'scored' as const}];
 const p={...livePolicy(),verified_model:'openai/gpt-4.1-mini',provider_slug:'azure',admissions_sha256:admissionsDigest(admissions)};
 const stages=['input','compressor','compressor','compressor','compressor','compressor','compressor','output'];
 const names=['inputDb','thresholdDb','ratio','attackMs','releaseMs','kneeDb','makeupDb','outputDb'];
 const units=['dB','dB','ratio','ms','ms','dB','dB','dB'] as const;
 // The last case reports 2,000 more input tokens than the prefix-plus-appended-bytes bound allows on the
 // second call (still under the old whole-prompt byte bound) and must fail closed.
 for(const [count,expected,reason,excess] of [[8,4,'token_budget_reservation',0],[24,3,'token_budget_reservation',0],[8,2,'provider_usage_exceeded_reservation',2000]] as const){
  const parameters=Array.from({length:count},(_,i)=>({stage_id:stages[i%8],parameter_id:i<8?names[i]:'band'+i+'Db',unit:units[i%8],value:0,min:-24,max:24}));
  let renders=0;
  const native:NativeAdapter={async snapshot(){return {session_id:'session_1',session_revision:1,source_sha256:'a'.repeat(64),base_graph_sha256:'b'.repeat(64),source_handle:'asset_compression_reduce_three',selection_samples:[0,192000],sample_rate:48000,parameters,passages:{origin:'manual',soft:[24000,72000],hard:[120000,168000]},processing:{compressor:true,multiband:false,equalizer:false,drive:false}};},
   async measurements(){return ['rms_dbfs','peak_dbfs','crest_db','soft_rms_dbfs','hard_rms_dbfs','contrast_db'].map(measurement_id=>({measurement_id,value:-23.456789,unit:'dBFS' as const}));},
   async render(){renders++;return {preview_id:'preview_'+renders,audio_sha256:'c'.repeat(64),session_revision:1,measurements:[{measurement_id:'preview_rms_dbfs',value:-18.123456,unit:'dBFS'}]};},
   async compare(){return ['rms_delta_db','peak_delta_db','contrast_delta_db'].map(measurement_id=>({measurement_id,value:-1.234567,unit:'dB' as const}));}};
  const model=new MockLanguageModelV4({modelId:p.verified_model,doGenerate:async options=>{const tokens=Math.ceil(Buffer.byteLength(JSON.stringify([options.prompt,options.tools]))/3)+(model.doGenerateCalls.length===2?excess:0);return {...response(model.doGenerateCalls.length===1?{kind:'render_candidate',parameter_patch:[{stage_id:'compressor',parameter_id:'thresholdDb',unit:'dB',value:-6}]}:{kind:'compare_candidate',preview_id:'preview_1'}),
   usage:{inputTokens:{total:tokens,noCache:tokens,cacheRead:0,cacheWrite:0},outputTokens:{total:40,text:40,reasoning:0}},response:{modelId:p.verified_model}};}});
  const directory=await mkdtemp(join(process.cwd(),'.test-runtime-gateway-headroom-'));
  try{
   const result=await new AssistantService(native,new StateStore(directory),new GatewayProvider(p,'mock',{model,async verifyMetadata(){}}),p,undefined,undefined,new AdmissionGuard(admissions)).run({schema_version:1,request_id:'headroom_1',session_id:'session_1',prompt});
   assert.equal(result.reason,reason,JSON.stringify([result.usage,model.doGenerateCalls.length]));
   assert.equal(model.doGenerateCalls.length,expected,`${count} controls`);
   assert.ok(result.usage.input_tokens<=12000,JSON.stringify(result.usage));
  }finally{await rm(directory,{recursive:true,force:true});}
 }
});
