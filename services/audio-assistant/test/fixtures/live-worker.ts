import {AdmissionGuard} from '../../agent/lib/live-admission.ts';
import {defaultAdmissions} from '../live-fixture.ts';
import {readFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {GatewayProvider} from '../../agent/lib/gateway-provider.ts';
import {endpointMetadataDigest} from '../../agent/lib/gateway-metadata.ts';
import {endpointFixture} from '../gateway-metadata-fixture.ts';
import {StateStore} from '../../agent/lib/store.ts';
import {LiveLedger,type LiveBinding,type Settlement} from '../../agent/lib/live-ledger.ts';
import {NativeCliAdapter} from '../../agent/lib/native-cli.ts';
import {AssistantService} from '../../agent/lib/service.ts';
import {createBroker,listenLoopback} from '../../agent/lib/broker.ts';
import type {LivePolicy} from '../../agent/lib/live-policy.ts';
const c=JSON.parse(await readFile(process.argv[2],'utf8'));
const waiters=new Map<string,()=>void>();
process.on('message',(m:unknown)=>{if(m&&typeof m==='object'&&'continue' in m)waiters.get(String(m.continue))?.();});
let stopped=false;
const barrier=async(point:string)=>{if(c.barrier!==point||stopped)return;stopped=true;await new Promise<void>(resolve=>{waiters.set(point,resolve);process.send?.({barrier:point});});};
class Store extends StateStore{
 override async load(s:string,r:string){await barrier('load');return super.load(s,r);}
 override async reserveLive(p:LivePolicy,b:LiveBinding,n:number,limits?:{global:number,per_session:number}){const out=await new LiveLedger(c.state,async point=>barrier('ledger_'+point)).reserve(p,b,n,limits);await barrier('reserve_after');return out;}
 override async beginGeneration(p:LivePolicy,b:LiveBinding){await super.beginGeneration(p,b);await barrier('generation_after');}
 override async settleLive(p:LivePolicy,b:LiveBinding,s:Settlement){await barrier('settle_before');await super.settleLive(p,b,s);await barrier('settle_after');}
 override async save(s:string,r:Parameters<StateStore['save']>[1]){const out=await super.save(s,r);await barrier('history_after');return out;}
}
const assets=new Map<string,any>(c.assets.map((a:any)=>[a.snapshot.session_id,a]));
class Native extends NativeCliAdapter{
 override async render(...args:Parameters<NativeCliAdapter['render']>){const out=await super.render(...args);await barrier('render_after');return out;}
}
const native=new Native(c.executable,assets,c.work);
const pricing={input:'0.000001',output:'0.000001'};
const endpoint=endpointFixture(c.policy.verified_model,c.policy.provider_slug);
const policy={...c.policy,metadata_sha256:endpointMetadataDigest(endpoint,c.policy.verified_model,c.policy.provider_slug)};
let calls=0;
// Exercises the installed real Gateway wire adapter and generateText structured-output code.
// This controlled fetch cannot access a network or a credential. Evidence is fault-injected.
const transport:typeof fetch=async(input,init)=>{
 const url=String(input);if(url.endsWith('/endpoints'))return Response.json(endpoint);if(!init?.method||init.method==='GET')return Response.json({models:[{id:policy.verified_model,name:'Controlled model',description:'fault injection',modelType:'language',specification:{specificationVersion:'v4',provider:'gateway',modelId:policy.verified_model},pricing}]});
 calls++;await appendFile(c.calls,JSON.stringify({pid:process.pid,call:calls,url})+'\n');await barrier('provider_during');
 if(c.failTransport)throw Error('controlled_transport_failure');
 const body=JSON.parse(String(init.body));
 const requestContent=body.prompt.find((m:any)=>m.role==='user').content;
 const first=JSON.parse(requestContent.find((p:any)=>p.type==='text').text);
 const snapshot=first.snapshot;
 const action=c.noop?{kind:'noop',reason:'Controlled transport result'}:calls===1?{kind:'render_candidate',parameter_patch:[{stage_id:'output',parameter_id:'outputDb',unit:'dB',value:3}]}:{kind:'propose_change',proposal:{schema_version:1,request_id:first.request.request_id,session_revision:snapshot.session_revision,source_sha256:snapshot.source_sha256,base_graph_sha256:snapshot.base_graph_sha256,selection_samples:snapshot.selection_samples,hypotheses:['Measured bounded gain.'],evidence_refs:first.measurements,parameter_patch:[{stage_id:'output',parameter_id:'outputDb',unit:'dB',value:3}],expected_tradeoffs:['Less headroom.'],limitations:['Fault injection only.'],requires_user_acceptance:true}};
 const {kind,...rest}=action as any;
 // propose_change names the rendered preview, read from the tool result the provider received.
 const rendered=body.prompt.filter((m:any)=>m.role==='tool').flatMap((m:any)=>m.content).map((p:any)=>p.output?.value?.preview?.preview_id).find(Boolean);
 const actionInput=kind==='propose_change'?{preview_id:rendered,proposal:(({parameter_patch,...p})=>p)(rest.proposal)}:rest;
 return Response.json({content:[{type:'tool-call',toolCallId:'call_controlled_'+calls,toolName:kind,input:JSON.stringify(actionInput)}],finishReason:{unified:'tool-calls',raw:'tool_calls'},usage:{inputTokens:{total:100,noCache:100,cacheRead:0,cacheWrite:0},outputTokens:{total:50,text:50,reasoning:0}},providerMetadata:{gateway:{generationId:'gen_controlled_'+calls}},response:{modelId:policy.verified_model,id:'controlled_response_'+calls},warnings:[]});
};
const store=new Store(c.state),provider=new GatewayProvider(policy,'controlled-not-a-credential',{fetch:transport});
const service=new AssistantService(native,store,provider,policy,undefined,undefined,new AdmissionGuard(defaultAdmissions));
const run=service.run.bind(service);service.run=async input=>{try{return await run(input);}catch(error){process.send?.({safe_error:error instanceof Error?error.message:'unknown'});throw error;}};
const server=createBroker(service,store,'t'.repeat(64),new Set(assets.keys()));const address=await listenLoopback(server);
process.send?.({ready:address,policy});
