import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {endpointMetadataDigest,verifyEndpointMetadata} from '../agent/lib/gateway-metadata.ts';
import {GatewayProvider} from '../agent/lib/gateway-provider.ts';
import {AssistantService} from '../agent/lib/service.ts';
import {StateStore} from '../agent/lib/store.ts';
import type {NativeAdapter} from '../agent/lib/contracts.ts';
import {livePolicy,defaultAdmissions} from './live-fixture.ts';
import {AdmissionGuard} from '../agent/lib/live-admission.ts';
import {endpointFixture} from './gateway-metadata-fixture.ts';
const native:NativeAdapter={async snapshot(){throw Error('metadata_must_block_first');},async measurements(){throw Error('unexpected');},async render(){throw Error('unexpected');},async compare(){throw Error('unexpected');}};
test('selected provider higher price blocks actual Gateway adapter despite cheap generic catalog',async()=>{const directory=await mkdtemp(join(process.cwd(),'.test-runtime-metadata-'));try{const p=livePolicy(),endpoint=endpointFixture(p.verified_model,p.provider_slug);endpoint.data.endpoints[0].pricing.prompt='0.000002';p.metadata_sha256=endpointMetadataDigest(endpoint,p.verified_model,p.provider_slug);let generations=0;const transport:typeof fetch=async(input,init)=>{if(String(input).endsWith('/endpoints'))return Response.json(endpoint);if(!init?.method||init.method==='GET')return Response.json({models:[{id:p.verified_model,name:'Controlled',specification:{specificationVersion:'v4',provider:'gateway',modelId:p.verified_model},pricing:{input:'0.0000001',output:'0.0000001'}}]});generations++;throw Error('unexpected_generation');};const out=await new AssistantService(native,new StateStore(directory),new GatewayProvider(p,'mock',{fetch:transport}),p,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run({schema_version:1,session_id:'s',request_id:'r',prompt:'keep level'});assert.equal(out.reason,'provider_snapshot_or_pricing_changed');assert.equal(generations,0);assert.equal(out.authorization?.provenance,'fault-injected');}finally{await rm(directory,{recursive:true,force:true});}});
test('endpoint identity, capability, explicit cache rates, tier ceiling and digest are mandatory',async()=>{
 const p=livePolicy();const make=()=>endpointFixture(p.verified_model,p.provider_slug);
 const valid=make();p.metadata_sha256=endpointMetadataDigest(valid,p.verified_model,p.provider_slug);await verifyEndpointMetadata(p,async()=>Response.json(valid),new AbortController().signal);
 const capability=make();capability.data.endpoints[0].supported_parameters=['max_tokens'];assert.throws(()=>endpointMetadataDigest(capability,p.verified_model,p.provider_slug),/structured_output_unverified/);
 const missing:any=make();delete missing.data.endpoints[0].pricing.input_cache_write;assert.throws(()=>endpointMetadataDigest(missing,p.verified_model,p.provider_slug));
 const wrong=make();wrong.data.endpoints[0].provider_name='other';assert.throws(()=>endpointMetadataDigest(wrong,p.verified_model,p.provider_slug),/endpoint_not_unique/);
 const duplicate=make();duplicate.data.endpoints.push(duplicate.data.endpoints[0]);assert.throws(()=>endpointMetadataDigest(duplicate,p.verified_model,p.provider_slug),/endpoint_not_unique/);
 const tier:any=make();tier.data.endpoints[0].pricing.input_cache_write_tiers=[{min:0,cost:'0.000003'}];const tierPolicy={...p,metadata_sha256:endpointMetadataDigest(tier,p.verified_model,p.provider_slug)};await assert.rejects(verifyEndpointMetadata(tierPolicy,async()=>Response.json(tier),new AbortController().signal),/pricing_changed/);
 const changed=make();changed.data.endpoints[0].context_length=64000;await assert.rejects(verifyEndpointMetadata(p,async()=>Response.json(changed),new AbortController().signal),/metadata_digest_mismatch/);
 const unknown:any=make();unknown.data.endpoints[0].pricing.unknown_fee='0.01';assert.throws(()=>endpointMetadataDigest(unknown,p.verified_model,p.provider_slug));
});

// Public endpoint metadata captured 2026-10-26; no prompts, credentials or generations.
const captured=async()=>JSON.parse(await readFile(new URL('./fixtures/gateway-endpoints-2026-10-26.json',import.meta.url),'utf8'));
test('captured public price fields remain bound; every service tier stays within consent ceilings',async()=>{
 const raw=await captured(),base={...livePolicy(),verified_model:'openai/gpt-4.1-mini',provider_slug:'azure',input_usd_per_million:.4,output_usd_per_million:1.6};
 const p={...base,metadata_sha256:endpointMetadataDigest(raw,base.verified_model,base.provider_slug)};
 await verifyEndpointMetadata(p,async()=>Response.json(raw),new AbortController().signal);
 const openai={...p,provider_slug:'openai',metadata_sha256:endpointMetadataDigest(raw,p.verified_model,'openai')};
 await assert.rejects(verifyEndpointMetadata(openai,async()=>Response.json(raw),new AbortController().signal),/pricing_changed/);
 await verifyEndpointMetadata({...openai,input_usd_per_million:.7,output_usd_per_million:2.8},async()=>Response.json(raw),new AbortController().signal);
 for(const tier of [{input_cache_write:'0.000003'},{completion_tiers:[{min:0,cost:'0.000004'}]}]){
  const higher=structuredClone(raw);higher.data.endpoints.find((e:any)=>e.provider_name==='azure').pricing.service_tiers={priority:tier};
  const higherPolicy={...p,metadata_sha256:endpointMetadataDigest(higher,p.verified_model,p.provider_slug)};
  await assert.rejects(verifyEndpointMetadata(higherPolicy,async()=>Response.json(higher),new AbortController().signal),/pricing_changed/);
 }
 const changed=structuredClone(raw);changed.data.endpoints.find((e:any)=>e.provider_name==='azure').pricing.web_search='0.02';
 await assert.rejects(verifyEndpointMetadata(p,async()=>Response.json(changed),new AbortController().signal),/metadata_digest_mismatch/);
});

test('unaccounted fees, unknown price fields and malformed rates still fail closed',async()=>{
 for(const [field,value] of [['request','0.01'],['internal_reasoning','0.01'],['discount',.1],['unknown_fee','0'],['image','-1'],['web_search','NaN']] as const){
  const raw=await captured();raw.data.endpoints[0].pricing[field]=value;assert.throws(()=>endpointMetadataDigest(raw,'openai/gpt-4.1-mini','azure'),field);
 }
 for(const [field,value] of [['request','0.01'],['internal_reasoning','0.01'],['discount',.1],['unknown_fee','0']] as const){
  const raw=await captured();raw.data.endpoints[0].pricing.service_tiers={priority:{prompt:'0.0000004',[field]:value}};assert.throws(()=>endpointMetadataDigest(raw,'openai/gpt-4.1-mini','azure'),field);
 }
});

test('higher nested cache and token tiers reject before any actual SDK generation',async()=>{
 const raw=await captured();raw.data.endpoints.find((e:any)=>e.provider_name==='azure').pricing.service_tiers={priority:{input_cache_read:'0.000003',completion_tiers:[{min:0,cost:'0.000004'}]}};
 const p={...livePolicy(),verified_model:'openai/gpt-4.1-mini',provider_slug:'azure',input_usd_per_million:.4,output_usd_per_million:1.6};p.metadata_sha256=endpointMetadataDigest(raw,p.verified_model,p.provider_slug);
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-metadata-current-'));let generations=0;
 try{
  const transport:typeof fetch=async(input,init)=>{if(String(input).endsWith('/endpoints'))return Response.json(raw);if(!init?.method||init.method==='GET')return Response.json({models:[{id:p.verified_model,name:'Controlled',specification:{specificationVersion:'v4',provider:'gateway',modelId:p.verified_model},pricing:{input:'0.0000004',output:'0.0000016'}}]});generations++;throw Error('unexpected_generation');};
  const result=await new AssistantService(native,new StateStore(directory),new GatewayProvider(p,'mock',{fetch:transport}),p,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run({schema_version:1,session_id:'s',request_id:'r',prompt:'keep level'});
  assert.equal(result.reason,'provider_snapshot_or_pricing_changed');assert.equal(generations,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('unknown metadata schema produces the generic sanitized failure before generation',async()=>{
 const raw=await captured(),p={...livePolicy(),verified_model:'openai/gpt-4.1-mini',provider_slug:'azure',input_usd_per_million:.4,output_usd_per_million:1.6};
 p.metadata_sha256=endpointMetadataDigest(raw,p.verified_model,p.provider_slug);
 raw.data.endpoints.find((e:any)=>e.provider_name==='azure').pricing.unknown_fee='0';
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-metadata-generic-'));let generations=0;
 try{
  const transport:typeof fetch=async(input,init)=>{if(String(input).endsWith('/endpoints'))return Response.json(raw);if(!init?.method||init.method==='GET')return Response.json({models:[{id:p.verified_model,name:'Controlled',specification:{specificationVersion:'v4',provider:'gateway',modelId:p.verified_model},pricing:{input:'0.0000004',output:'0.0000016'}}]});generations++;throw Error('unexpected_generation');};
  const result=await new AssistantService(native,new StateStore(directory),new GatewayProvider(p,'mock',{fetch:transport}),p,undefined,undefined,new AdmissionGuard(defaultAdmissions)).run({schema_version:1,session_id:'s',request_id:'r',prompt:'keep level'});
  assert.equal(result.status,'failed');assert.equal(result.reason,'request_failed');assert.equal(generations,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
