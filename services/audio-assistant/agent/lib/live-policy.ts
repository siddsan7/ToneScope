import { z } from 'zod';
import { createHash } from 'node:crypto';

// Configuration validation must not initialize the live provider SDK.
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const LIVE_PROTOCOL_SHA256='5049a18bc38b3584961ca7e8dcfd7b984e58be3188f620f39a4e55597fc70aee';
export const LIVE_LIMITS=Object.freeze({tool_calls:8,candidates:3,render_seconds:30,wall_ms:60000,input_tokens:12000,output_tokens:4000});
const limitsSchema=z.object({tool_calls:z.literal(8),candidates:z.literal(3),render_seconds:z.literal(30),wall_ms:z.literal(60000),input_tokens:z.literal(12000),output_tokens:z.literal(4000)}).strict();
export const livePolicySchema=z.object({schema_version:z.literal(1),consent:z.literal(true),experiment_id:id,budget_id:id,protocol_sha256:z.literal(LIVE_PROTOCOL_SHA256),task_sha256:hash,schedule_sha256:hash,admissions_sha256:hash,metadata_sha256:hash,currency:z.literal('USD'),budget_usd:z.number().finite().positive(),verified_model:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(120),provider_slug:z.string().regex(/^[a-z0-9-]{1,80}$/),verified_at:z.iso.datetime(),input_usd_per_million:z.number().finite().nonnegative(),output_usd_per_million:z.number().finite().nonnegative(),pricing_source:z.literal('https://ai-gateway.vercel.sh/v1/models'),limits:limitsSchema,max_requests:z.number().int().positive().max(180),max_generations:z.number().int().positive().max(1440),approved_data_classes:z.tuple([z.literal('request_text'),z.literal('scalar_measurements'),z.literal('authorized_controls'),z.literal('identity_metadata')])}).strict();
export type LivePolicy=z.infer<typeof livePolicySchema>;
/** ASCII object keys sorted recursively; compact UTF-8 JSON, no newline. Arrays retain order. */
export function canonicalJson(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson((value as Record<string,unknown>)[k])).join(',')+'}';}
export const jsonDigest=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export const consentDigest=(policy:unknown)=>jsonDigest(livePolicySchema.parse(policy));
export function validateConsent(policy:unknown){const p=livePolicySchema.parse(policy);const age=Date.now()-Date.parse(p.verified_at);if(age<0||age>86400000)throw Error('live_not_authorized');return p;}
