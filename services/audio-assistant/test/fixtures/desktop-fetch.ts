import {appendFileSync} from 'node:fs';
import {endpointFixture} from '../gateway-metadata-fixture.ts';
// Offline HTTP responses for the production Gateway SDK fetch seam. This module
// never sends a request. A production configuration cannot import this seam.
const model='test/model',provider='test';
const json=(value:unknown)=>Response.json(value);
export default async function transport(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
 const url=String(input);
 if(url.endsWith('/config'))return json({models:[{id:model,name:'Private fault fixture',pricing:{input:'0.000001',output:'0.000001'},specification:{specificationVersion:'v4',provider:'gateway',modelId:model}}]});
 if(url.endsWith('/endpoints'))return json(endpointFixture(model,provider));
 if(!url.endsWith('/language-model')||init?.method!=='POST')throw Error('fixture_network_forbidden');
 const audit=process.env.TONESCOPE_DESKTOP_FETCH_AUDIT;if(audit)appendFileSync(audit,JSON.stringify({event:'fixture_generation'})+'\n');
 const body=JSON.parse(String(init.body));
 const texts=body.prompt.filter((m:{role:string})=>m.role==='user').flatMap((m:{content:Array<{type:string;text?:string}>})=>m.content.filter(c=>c.type==='text').map(c=>JSON.parse(c.text!)));
 const initial=texts.find((t:{snapshot?:unknown})=>t.snapshot),snapshot=initial.snapshot;
 const completed=texts.find((t:{tool_result?:unknown})=>t.tool_result);
 const fault=process.env.TONESCOPE_DESKTOP_FAULT??'';
 if(fault==='late')await new Promise(resolve=>setTimeout(resolve,1500));
 const compression=snapshot.parameters.some((p:{parameter_id:string})=>p.parameter_id==='thresholdDb');
 const patch=[compression?{stage_id:'compressor',parameter_id:'thresholdDb',unit:'dBFS',value:fault==='compression-wrong'?-24:-20.5}:{stage_id:'output',parameter_id:'outputDb',unit:'dB',value:snapshot.parameters[0].value-3}];
 const action=fault==='noop'||fault==='abstain'?{kind:fault,reason:'Private deterministic terminal fixture.'}:!completed?{kind:'render_candidate',parameter_patch:patch}:{kind:'propose_change',proposal:{schema_version:1,request_id:initial.request.request_id,session_revision:snapshot.session_revision,source_sha256:snapshot.source_sha256,base_graph_sha256:snapshot.base_graph_sha256,selection_samples:snapshot.selection_samples,hypotheses:['The measured candidate reduces the requested quantity.'],evidence_refs:initial.measurements.filter((m:{measurement_id:string})=>m.measurement_id==='rms_dbfs'),parameter_patch:patch,expected_tradeoffs:['Less output or stronger gain reduction.'],limitations:['Deterministic fault injection; no model or listening qualification.'],requires_user_acceptance:true}};
 return json({content:[{type:'text',text:JSON.stringify({action})}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:100,noCache:100,cacheRead:0,cacheWrite:0},outputTokens:{total:50,text:50,reasoning:0}},providerMetadata:{gateway:{generationId:'gen_fixture_'+(completed?'proposal':'render')}},warnings:[]});
}
