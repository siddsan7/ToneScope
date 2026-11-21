import {z} from 'zod';
import {jsonDigest,type LivePolicy} from './live-policy.ts';
const rate=z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(s=>Number.isFinite(Number(s))&&Number(s)>=0);
const tier=z.object({cost:rate,min:z.number().int().nonnegative(),max:z.number().int().positive().optional()}).strict().refine(t=>t.max===undefined||t.max>t.min);
const tokenFields={prompt:rate,completion:rate,input_cache_read:rate,input_cache_write:rate};
const tiers={prompt_tiers:z.array(tier).max(32),completion_tiers:z.array(tier).max(32),input_cache_read_tiers:z.array(tier).max(32),input_cache_write_tiers:z.array(tier).max(32)};
// Only text JSON and local actions are sent. Hosted image/search units cannot be invoked.
// Per-request or separately charged reasoning units are not covered by our token ledger.
const extraFields={request:rate.refine(s=>Number(s)===0).optional(),internal_reasoning:rate.refine(s=>Number(s)===0).optional(),discount:z.literal(0).optional(),image:rate.optional(),image_output:rate.optional(),web_search:rate.optional()};
const serviceTier=z.object({...tokenFields,...tiers,...extraFields}).partial().strict();
const pricing=z.object({...tokenFields,prompt_tiers:tiers.prompt_tiers.default([]),completion_tiers:tiers.completion_tiers.default([]),input_cache_read_tiers:tiers.input_cache_read_tiers.default([]),input_cache_write_tiers:tiers.input_cache_write_tiers.default([]),...extraFields,service_tiers:z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),serviceTier).refine(t=>Object.keys(t).length<=16).optional()}).strict();
const endpoint=z.object({provider_name:z.string(),status:z.literal(0),context_length:z.number().int().min(16000),max_completion_tokens:z.number().int().min(2048),supported_parameters:z.array(z.string()).max(128),tags:z.array(z.string()).max(128).default([]),supports_implicit_caching:z.boolean(),pricing}).passthrough();
const document=z.object({data:z.object({id:z.string(),architecture:z.object({input_modalities:z.array(z.string()).max(16),output_modalities:z.array(z.string()).max(16)}).passthrough(),endpoints:z.array(z.unknown()).max(128)}).passthrough()}).passthrough();
/** A narrow stable projection excludes volatile uptime/latency fields. Missing prices fail closed. */
export function endpointMetadata(raw:unknown,modelId:string,provider:string){
 const d=document.parse(raw).data;if(d.id!==modelId||!d.architecture.input_modalities.includes('text')||!d.architecture.output_modalities.includes('text'))throw Error('provider_endpoint_identity_mismatch');
 const matches=d.endpoints.filter(e=>e&&typeof e==='object'&&(e as {provider_name?:unknown}).provider_name===provider);
 if(matches.length!==1)throw Error('provider_endpoint_not_unique');
 const e=endpoint.parse(matches[0]);if(!e.supported_parameters.includes('max_tokens')||!e.supported_parameters.includes('response_format'))throw Error('provider_structured_output_unverified');
 return {model_id:modelId,architecture:{input_modalities:[...d.architecture.input_modalities].sort(),output_modalities:[...d.architecture.output_modalities].sort()},endpoint:{provider_name:e.provider_name,status:e.status,context_length:e.context_length,max_completion_tokens:e.max_completion_tokens,supported_parameters:[...e.supported_parameters].sort(),tags:[...e.tags].sort(),supports_implicit_caching:e.supports_implicit_caching,pricing:e.pricing}};
}
export const endpointMetadataDigest=(raw:unknown,modelId:string,provider:string)=>jsonDigest(endpointMetadata(raw,modelId,provider));
export async function verifyEndpointMetadata(policy:LivePolicy,transport:typeof fetch,signal:AbortSignal){
 const parts=policy.verified_model.split('/');if(parts.length!==2||parts.some(p=>!p||p==='.'||p==='..'))throw Error('provider_model_identity_invalid');
 const response=await transport('https://ai-gateway.vercel.sh/v1/models/'+parts.map(encodeURIComponent).join('/')+'/endpoints',{method:'GET',redirect:'error',signal});
 if(!response.ok||Number(response.headers.get('content-length')??0)>1048576)throw Error('provider_metadata_unavailable');
 const chunks:Uint8Array[]=[];let bytes=0;if(!response.body)throw Error('provider_metadata_unavailable');for await(const chunk of response.body){bytes+=chunk.length;if(bytes>1048576)throw Error('provider_metadata_excessive');chunks.push(chunk);}signal.throwIfAborted();
 const metadata=endpointMetadata(JSON.parse(Buffer.concat(chunks).toString('utf8')),policy.verified_model,policy.provider_slug);
 if(jsonDigest(metadata)!==policy.metadata_sha256)throw Error('provider_metadata_digest_mismatch');
 const p=metadata.endpoint.pricing;
 const prices=[p,...Object.values(p.service_tiers??{})];
 const input=prices.flatMap(t=>[t.prompt,t.input_cache_read,t.input_cache_write,...(t.prompt_tiers??[]).map(t=>t.cost),...(t.input_cache_read_tiers??[]).map(t=>t.cost),...(t.input_cache_write_tiers??[]).map(t=>t.cost)]).filter((r):r is string=>r!==undefined);
 const output=prices.flatMap(t=>[t.completion,...(t.completion_tiers??[]).map(t=>t.cost)]).filter((r):r is string=>r!==undefined);
 if(input.some(r=>Number(r)*1e6>policy.input_usd_per_million)||output.some(r=>Number(r)*1e6>policy.output_usd_per_million))throw Error('provider_snapshot_or_pricing_changed');
}
