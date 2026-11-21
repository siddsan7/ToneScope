import { readFile,writeFile,rename } from 'node:fs/promises';
import { z } from 'zod';
import { baselineMetricsSchema,snapshotSchema } from './contracts.ts';
import { NativeCliAdapter } from './native-cli.ts';
import { StateStore } from './store.ts';
import { canonicalJson,consentDigest,validateConsent,livePolicySchema } from './live-policy.ts';
import {AdmissionGuard,admissionsSchema} from './live-admission.ts';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import { AssistantService } from './service.ts';
import { createBroker,listenLoopback } from './broker.ts';
// Private host-created manifest is the sole path registration surface;
// Never supplied by the model.
const config=z.object({executable:z.string(),work_directory:z.string(),state_directory:z.string(),port:z.number().int().min(0).max(65535).default(0),assets:z.array(z.object({snapshot:snapshotSchema,source_path:z.string(),baseline_path:z.string().optional(),baseline_metrics:baselineMetricsSchema.optional(),parameters:z.record(z.string(),z.union([z.number(),z.boolean(),z.array(z.number())]))}).strict().refine(a=>Boolean(a.baseline_path)!==Boolean(a.baseline_metrics))).max(8)}).strict();
// The native host passes a protected env file explicitly; inherited shell values cannot enable live mode or replace its capability.
const nativeArgument=process.argv.indexOf('--native-env-file');
if(nativeArgument>=0){
 const file=process.argv[nativeArgument+1];if(!file)throw Error('native_environment_file_required');
 const text=await readFile(file,'utf8');if(Buffer.byteLength(text)>4096)throw Error('native_environment_file_excessive');
 const lines=text.trim().split(/\r?\n/);const values=new Map<string,string>();
 for(const line of lines){const match=/^(TONESCOPE_HOST_MANIFEST|TONESCOPE_BROKER_TOKEN|TONESCOPE_ENABLE_LIVE)=(.*)$/.exec(line);if(!match||values.has(match[1]))throw Error('native_environment_file_invalid');let value=match[2];if(value.startsWith('"')&&value.endsWith('"'))value=value.slice(1,-1);values.set(match[1],value);}
 if(values.size!==3||values.get('TONESCOPE_ENABLE_LIVE')!=='0'||!/^[a-f0-9]{64}$/.test(values.get('TONESCOPE_BROKER_TOKEN')??''))throw Error('native_environment_file_invalid');
 process.env.TONESCOPE_HOST_MANIFEST=values.get('TONESCOPE_HOST_MANIFEST');process.env.TONESCOPE_BROKER_TOKEN=values.get('TONESCOPE_BROKER_TOKEN');process.env.TONESCOPE_ENABLE_LIVE='0';
}
const manifestPath=process.env.TONESCOPE_HOST_MANIFEST;
const token=process.env.TONESCOPE_BROKER_TOKEN;
if(!manifestPath||!token)throw Error('Native host manifest and private broker token are required.');
const c=config.parse(JSON.parse(await readFile(manifestPath,'utf8')));
const assets=new Map(c.assets.map(a=>[a.snapshot.session_id,a]));
const native=new NativeCliAdapter(c.executable,async()=>{const fresh=config.parse(JSON.parse(await readFile(manifestPath,'utf8')));
return new Map(fresh.assets.map(a=>[a.snapshot.session_id,a]));
},c.work_directory);

// Only an explicit host CLI argument can enable the private experiment.
const liveArgument=process.argv.indexOf('--native-evaluation-config');
const evaluationSchema=z.object({schema_version:z.literal(1),mode:z.enum(['live','fault-injected']),policy:livePolicySchema,canonical_policy_json:z.string().min(2).max(16384),consent_sha256:z.string().regex(/^[a-f0-9]{64}$/),admissions:admissionsSchema,state_directory:z.string().refine(isAbsolute),lifecycle_request_id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),test_fetch_module:z.string().refine(isAbsolute).optional()}).strict();
const evaluation=liveArgument<0?undefined:evaluationSchema.parse(JSON.parse(await readFile(process.argv[liveArgument+1],'utf8')));
const enableLive=Boolean(evaluation);
if(evaluation){
 if(nativeArgument<0)throw Error('native_explicit_opt_in_required');
 validateConsent(evaluation.policy);
 if(evaluation.canonical_policy_json!==canonicalJson(evaluation.policy))throw Error('native_canonical_policy_mismatch');
 if(evaluation.admissions.length!==180||evaluation.admissions.filter(a=>a.role==='scored').length!==168||evaluation.admissions.filter(a=>a.role==='setup').length!==6||evaluation.admissions.filter(a=>a.role==='lifecycle').length!==6)throw Error('incomplete_frozen_admissions');
 if(!evaluation.admissions.some(a=>a.role==='lifecycle'&&a.request_id===evaluation.lifecycle_request_id))throw Error('lifecycle_request_required');
 if(evaluation.consent_sha256!==consentDigest(evaluation.policy))throw Error('native_consent_digest_mismatch');
 if((evaluation.mode==='fault-injected')!==Boolean(evaluation.test_fetch_module))throw Error('native_test_seam_forbidden');
 if(evaluation.mode==='live'&&!process.env.AI_GATEWAY_API_KEY)throw Error('live_configuration_and_credentials_required');
}
const admission=evaluation?new AdmissionGuard(evaluation.admissions,['lifecycle']):undefined;
if(evaluation&&admission!.digest!==evaluation.policy.admissions_sha256)throw Error('admission_manifest_digest_mismatch');
const injected=evaluation?.test_fetch_module?{fetch:(await import(pathToFileURL(evaluation.test_fetch_module).href)).default as typeof fetch}:undefined;
const provider=evaluation?new (await import('./gateway-provider.ts')).GatewayProvider(evaluation.policy,evaluation.mode==='fault-injected'?'fault-injected-never-sent':process.env.AI_GATEWAY_API_KEY!,injected):undefined;
// A single store owns request history and durable budget identity in both layers.
const store=new StateStore(evaluation?.state_directory??c.state_directory);
for(const removed of await store.prune())await native.releasePreview(removed.session_hash,removed.preview_id);
const service=new AssistantService(native,store,provider,evaluation?.policy,undefined,undefined,admission);
const server=createBroker(service,store,token,new Set(assets.keys()));
const address=await listenLoopback(server,c.port);
const ready=JSON.stringify({schema_version:1,address,provider:enableLive?'gateway':'rules',live_enabled:enableLive,...(evaluation?{consent_sha256:evaluation.consent_sha256,experiment_id:evaluation.policy.experiment_id,budget_id:evaluation.policy.budget_id,provenance:evaluation.mode}:{})});
const readyArgument=process.argv.indexOf('--native-ready-file');
if(readyArgument>=0){if(nativeArgument<0||!process.argv[readyArgument+1])throw Error('native_ready_file_not_authorized');const path=process.argv[readyArgument+1];await writeFile(path+'.tmp',ready,{mode:0o600,flag:'wx'});await rename(path+'.tmp',path);}else process.stdout.write(ready+'\n');
