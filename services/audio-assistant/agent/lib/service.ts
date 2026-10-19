import { randomUUID,createHash } from 'node:crypto';
import { z } from 'zod';
import { snapshotSchema, measurementSchema, previewSchema, proposalSchema, requestSchema, renderInput, previewInput, emptyInput, type Snapshot, type Measurement, type Patch, type Preview, type Proposal, type RequestInput, type NativeAdapter, type Envelope, type Usage } from './contracts.ts';
import { StateStore } from './store.ts';
import { parseLevelIntent } from './level-intent.ts';
import { isCompressionRequest,runCompressionRules } from './compression-rules.ts';
export const LIMITS=Object.freeze({request_bytes:8192,measurements:32,tool_calls:8,candidates:3,render_seconds:30,wall_ms:60000,input_tokens:12000,output_tokens:4000});
export interface Provider {kind:'rules'|'replay'|'live';
 run(request:RequestInput,tools:RequestTools,signal:AbortSignal):Promise<{status:'noop'|'abstain';
reason:string}|{status:'ready';
proposal:Proposal;
preview_id:string}>;
}
export type LivePolicy={consent:boolean;
currency:'USD';
budget_usd:number;
verified_model:string;
verified_at:string;
input_usd_per_million:number;
output_usd_per_million:number;
pricing_source:string};
const same=(a:Snapshot,b:Snapshot)=>a.session_id===b.session_id&&a.session_revision===b.session_revision&&a.source_sha256===b.source_sha256&&a.base_graph_sha256===b.base_graph_sha256&&JSON.stringify(a.selection_samples)===JSON.stringify(b.selection_samples)&&JSON.stringify(a.passages)===JSON.stringify(b.passages)&&JSON.stringify(a.processing)===JSON.stringify(b.processing);
export class RequestTools {
 async releaseUnused(keep?:string){for(const id of this.previews.keys())if(id!==keep){await this.native.releasePreview?.(createHash('sha256').update(this.request.session_id).digest('hex'),id);this.previews.delete(id);}}

 readonly usage:Usage={tool_calls:0,candidate_frames:0,input_tokens:0,output_tokens:0,cost_usd:0,latency_ms:0};
 private base?:Snapshot;
 private evidence:Measurement[]=[];
 private previews=new Map<string,{preview:Preview;
patch:Patch[];
compared:boolean}>();
 private candidateCount=0;
 readonly request:RequestInput;
 private native:NativeAdapter;
 readonly signal:AbortSignal;
 constructor(request:RequestInput,native:NativeAdapter,signal:AbortSignal){this.request=request;
this.native=native;
this.signal=signal;
}
 check(){this.signal.throwIfAborted();
}
 private charge(){this.check();
if(++this.usage.tool_calls>LIMITS.tool_calls)throw Error('tool_call_limit');
}
 async snapshot(){this.charge();
const s=snapshotSchema.parse(await this.native.snapshot(this.request.session_id,this.signal));
this.check();
if(s.session_id!==this.request.session_id)throw Error('cross_session');
if(this.base&&!same(this.base,s))throw Error('stale_session');
this.base=s;
return structuredClone(s);
}
 private requireBase(){if(!this.base)throw Error('snapshot_required');
return this.base;
}
 async measurements(){this.charge();
const data=z.array(measurementSchema).max(32).parse(await this.native.measurements(this.requireBase(),this.signal));
this.check();
if(new Set(data.map(x=>x.measurement_id)).size!==data.length)throw Error('duplicate_measurement');
this.evidence=data;
return structuredClone(data);
}
 private validatePatch(patch:Patch[]){const base=this.requireBase();
const seen=new Set<string>();
for(const p of patch){if(typeof p.value==='boolean'||['compressor','equalizer','drive','oversampling','order'].includes(p.parameter_id))throw Error('topology_change_forbidden');
const key=p.stage_id+'\0'+p.parameter_id;
if(seen.has(key))throw Error('duplicate_parameter');
seen.add(key);
const parameter=base.parameters.find(x=>x.stage_id===p.stage_id&&x.parameter_id===p.parameter_id);
if(!parameter||parameter.unit!==p.unit||typeof parameter.value!==typeof p.value||(typeof p.value==='number'&&(p.value<parameter.min||p.value>parameter.max)))throw Error('unauthorized_parameter');
}}
 async render(input:unknown){this.charge();
const {parameter_patch}=renderInput.parse(input);
this.validatePatch(parameter_patch);
const base=this.requireBase();
const frames=await this.native.renderFrameCost?.(base,this.signal)??base.selection_samples[1];
this.check();
if(!Number.isSafeInteger(frames)||frames<base.selection_samples[1])throw Error('invalid_render_cost');
if(++this.candidateCount>3||this.usage.candidate_frames+frames>base.sample_rate*30)throw Error('render_limit');
this.usage.candidate_frames+=frames;
const preview=previewSchema.parse(await this.native.render(base,parameter_patch,this.signal));
this.check();
if(preview.session_revision!==base.session_revision||this.previews.has(preview.preview_id))throw Error('invalid_preview');
this.previews.set(preview.preview_id,{preview,patch:structuredClone(parameter_patch),compared:false});
return structuredClone(preview);
}
 async compare(input:unknown){this.charge();
const {preview_id}=previewInput.parse(input);
const candidate=this.previews.get(preview_id);
if(!candidate)throw Error('unknown_preview');
const result=z.array(measurementSchema).max(32).parse(await this.native.compare(this.requireBase(),candidate.preview,this.signal));
this.check();
candidate.compared=true;
return result;
}
 async propose(input:unknown){this.charge();
const p=proposalSchema.parse(input);
if([...p.hypotheses,...p.expected_tradeoffs,...p.limitations].some(text=>/\d/.test(text)))throw Error('numeric_claim_requires_structured_evidence');
const base=this.requireBase();
if(p.request_id!==this.request.request_id||p.session_revision!==base.session_revision||p.source_sha256!==base.source_sha256||p.base_graph_sha256!==base.base_graph_sha256||JSON.stringify(p.selection_samples)!==JSON.stringify(base.selection_samples))throw Error('proposal_binding');
this.validatePatch(p.parameter_patch);
if(p.evidence_refs.some(e=>!this.evidence.some(x=>JSON.stringify(x)===JSON.stringify(e))))throw Error('forged_evidence');
const candidate=[...this.previews.values()].find(x=>x.compared&&JSON.stringify(x.patch)===JSON.stringify(p.parameter_patch));
if(!candidate)throw Error('evaluated_preview_required');
const current=snapshotSchema.parse(await this.native.snapshot(this.request.session_id,this.signal));
this.check();
if(!same(base,current))throw Error('stale_session');
await this.native.verifyPreview?.(base,candidate.preview,this.signal);
this.check();
return {proposal:p,preview:candidate.preview};
}
 async call(name:string,input:unknown){if(name==='get_session_snapshot'){emptyInput.parse(input);
return this.snapshot();
}if(name==='get_measurements'){emptyInput.parse(input);
return this.measurements();
}if(name==='render_candidate')return this.render(input);
if(name==='compare_candidate')return this.compare(input);
if(name==='propose_change')return this.propose(input);
throw Error('unknown_tool');
}
}
export class RulesProvider implements Provider {
 readonly kind='rules' as const;
 async run(r:RequestInput,t:RequestTools){const s=await t.snapshot();
const measurements=await t.measurements();
if(isCompressionRequest(r.prompt))return runCompressionRules(r,s,measurements,t);
const rms=measurements.find(x=>x.measurement_id==='rms_dbfs'&&x.unit==='dBFS');
const gain=s.parameters.find(x=>x.stage_id==='output'&&x.parameter_id==='outputDb'&&x.unit==='dB'&&typeof x.value==='number');
const intent=parseLevelIntent(r.prompt);
if(!intent)return {status:'abstain' as const,reason:'The rules baseline requires one supported, unambiguous level request.'};
if(intent.kind==='keep')return {status:'noop' as const,reason:'The request leaves the level unchanged.'};
if(!rms||!gain)return {status:'abstain' as const,reason:'A calibrated RMS measurement and authorized gain parameter are required.'};
if(rms.value<=-180)return {status:'abstain' as const,reason:'The baseline is silent or below the reliable measurement floor.'};
const peak=measurements.find(x=>x.measurement_id==='peak_dbfs'&&x.unit==='dBFS');
const current=gain.value as number;
if(gain.min>current||current>gain.max)return {status:'abstain' as const,reason:'The current output gain is outside the authorized range.'};
const lower=gain.min-current;
const upper=Math.min(gain.max-current,peak?intent.ceiling-peak.value:Infinity);
const desired=intent.kind==='maximize'?upper:intent.kind==='target'?intent.value-rms.value:intent.exact?intent.value:intent.value<0?-3:Math.max(3,Math.min(6,-18-rms.value));
// This epsilon handles float32 measurement noise, not task grading tolerance.
const epsilon=1e-5;
if(intent.kind==='maximize'&&!peak)return {status:'abstain' as const,reason:'A calibrated sample peak is required to maximize level.'};
if(intent.kind!=='maximize'&&intent.exact&&(desired<lower-epsilon||desired>upper+epsilon||Math.abs(desired)>epsilon&&!peak))return {status:'abstain' as const,reason:'The requested level cannot be verified within the authorized gain range and sample peak ceiling.'};
if(upper<lower-epsilon)return {status:'abstain' as const,reason:'The sample peak ceiling cannot be met within the authorized gain range.'};
if(intent.kind==='delta'&&!intent.exact&&desired>0&&upper< -epsilon)return {status:'abstain' as const,reason:'The sample peak ceiling prevents the requested increase.'};
const delta=intent.kind==='maximize'?upper:intent.exact?desired:Math.max(lower,Math.min(upper,desired));
if(Math.abs(delta)<=epsilon)return {status:'noop' as const,reason:'The measured level already meets the request or permits no further gain.'};
const value=Math.max(gain.min,Math.min(gain.max,current+delta));
const patch:Patch[]=[{stage_id:gain.stage_id,parameter_id:gain.parameter_id,unit:'dB',value}];
const preview=await t.render({parameter_patch:patch});
await t.compare({preview_id:preview.preview_id});
return {status:'ready' as const,preview_id:preview.preview_id,proposal:{schema_version:1 as const,request_id:r.request_id,session_revision:s.session_revision,source_sha256:s.source_sha256,base_graph_sha256:s.base_graph_sha256,selection_samples:s.selection_samples,hypotheses:['A bounded gain adjustment changes measured output level.'],evidence_refs:peak?[rms,peak]:[rms],parameter_patch:patch,expected_tradeoffs:['Gain changes peak headroom; compare the preview before accepting.'],limitations:['Deterministic level baseline; no tonal or perceptual quality judgment.'],requires_user_acceptance:true as const}};
}
}
export class AssistantService {
 private lifetimeLimits:{requests:number,deleted_sessions:number};
 private admitted=new Map<string,string>();
 private admissionLimits:{global:number,per_session:number};
 private active=new Map<string,{session:string;
controller:AbortController}>();
private seen=new Set<string>();
private deleting=new Set<string>();
 private native:NativeAdapter;
private store:StateStore;
private provider:Provider;
private livePolicy?:LivePolicy;
constructor(native:NativeAdapter,store:StateStore,provider:Provider=new RulesProvider(),livePolicy?:LivePolicy,admissionLimits={global:2,per_session:1},lifetimeLimits={requests:4096,deleted_sessions:256}){this.lifetimeLimits={...lifetimeLimits};for(const value of Object.values(lifetimeLimits))if(!Number.isSafeInteger(value)||value<=0)throw Error('lifetime_limits_invalid');this.admissionLimits={...admissionLimits};for(const value of Object.values(admissionLimits))if(!Number.isSafeInteger(value)||value<=0)throw Error('admission_limits_invalid');this.native=native;
this.store=store;
this.provider=provider;
this.livePolicy=livePolicy;
}
 cancel(session:string,request:string){const work=this.active.get(request);
if(work?.session===session)work.controller.abort(Error('canceled'));
}
 async deleteSession(session:string){if(!this.deleting.has(session)&&this.deleting.size>=this.lifetimeLimits.deleted_sessions)throw Error('deleted_session_capacity');this.deleting.add(session);
for(const [id,work] of this.active)if(work.session===session)this.cancel(session,id);
await this.store.deleteSession(session);
await this.native.deleteSession?.(session);
}
 async run(raw:unknown):Promise<Envelope>{if(Buffer.byteLength(JSON.stringify(raw))>8192)throw Error('request_bytes_limit');
const r=requestSchema.parse(raw);
if(this.deleting.has(r.session_id))throw Error('session_deleted');
if(this.seen.has(r.request_id))throw Error('duplicate_request');
if(this.admitted.size>=this.admissionLimits.global||[...this.admitted.values()].filter(session=>session===r.session_id).length>=this.admissionLimits.per_session)throw Error('assistant_busy');
if(this.seen.size>=this.lifetimeLimits.requests)throw Error('request_identity_capacity');
this.admitted.set(r.request_id,r.session_id);try{
this.seen.add(r.request_id);
if(await this.store.load(r.session_id,r.request_id))throw Error('duplicate_request');
const start=Date.now();
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(Error('timed_out')),60000);
timer.unref();
this.active.set(r.request_id,{session:r.session_id,controller});
const t=new RequestTools(r,this.native,controller.signal);
let reservedCost=0;
let result:Envelope={schema_version:1,request_id:r.request_id,status:'failed',proposal:null,preview:null,reason:null,usage:t.usage,trace_id:randomUUID(),evidence_refs:[]};
try{if(this.provider.kind==='live'){const p=this.livePolicy;
const worst=(12000*(p?.input_usd_per_million??Infinity)+4000*(p?.output_usd_per_million??Infinity))/1e6;
if(!p?.consent||p.currency!=='USD'||!(p.budget_usd>0)||!p.verified_model||!p.pricing_source||!Number.isFinite(worst)||worst>p.budget_usd||(Date.now()-Date.parse(p.verified_at)>86400000||Date.parse(p.verified_at)>Date.now())||!Number.isFinite(Date.parse(p.verified_at)))throw Error('live_not_authorized');
await this.store.updateBudget(p.budget_usd,worst);reservedCost=worst;
}const output=await Promise.race([this.provider.run(r,t,controller.signal),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}))]);
t.check();
if(t.usage.input_tokens>12000||t.usage.output_tokens>4000)throw Error('token_limit');
if(!Number.isFinite(t.usage.cost_usd)||t.usage.cost_usd<0||(this.provider.kind==='live'&&t.usage.cost_usd>(this.livePolicy?.budget_usd??0)))throw Error('cost_limit');
if(output.status==='ready'){const evaluated=await t.propose(output.proposal);
if(evaluated.preview.preview_id!==output.preview_id)throw Error('preview_binding');
result={...result,status:'ready',...evaluated,evidence_refs:evaluated.proposal.evidence_refs};
}else result={...result,status:output.status,reason:output.reason.slice(0,500)};
}catch(e){const reason=controller.signal.aborted?String(controller.signal.reason?.message):e instanceof Error?e.message:'request_failed';
result={...result,status:reason==='canceled'?'canceled':reason==='timed_out'?'timed_out':'failed',reason:/^[a-z_]{1,80}$/.test(reason)?reason:'request_failed'};
}finally{clearTimeout(timer);
this.active.delete(r.request_id);
result.usage.latency_ms=Date.now()-start;
}if(reservedCost>0){await this.store.updateBudget(this.livePolicy!.budget_usd,t.usage.cost_usd-reservedCost,true);}
await t.releaseUnused(result.preview?.preview_id);
if(!this.deleting.has(r.session_id)){const removed=await this.store.save(r.session_id,result);for(const item of removed)await this.native.releasePreview?.(item.session_hash,item.preview_id);}
return result;
}finally{this.admitted.delete(r.request_id);}
}
}
