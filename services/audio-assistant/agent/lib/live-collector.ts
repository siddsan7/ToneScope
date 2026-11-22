/** Separate spending entry point. Never imported by offline runners or the desktop host. */
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {baselineMetricsSchema,snapshotSchema,requestSchema} from './contracts.ts';
import {livePolicySchema,consentDigest,jsonDigest,validateConsent,LIVE_LIMITS} from './live-policy.ts';
import {armStallWatchdog} from './live-stall.ts';
import {NativeCliAdapter} from './native-cli.ts';
import {StateStore} from './store.ts';
import {AssistantService} from './service.ts';
import {AdmissionGuard,admissionsSchema} from './live-admission.ts';
const inputSchema=z.object({schema_version:z.literal(1),consent_sha256:z.string().regex(/^[a-f0-9]{64}$/),protocol_sha256:z.string().regex(/^[a-f0-9]{64}$/),task_sha256:z.string().regex(/^[a-f0-9]{64}$/),schedule_sha256:z.string().regex(/^[a-f0-9]{64}$/),request:requestSchema}).strict();
const manifestSchema=z.object({executable:z.string(),work_directory:z.string(),state_directory:z.string(),admissions:admissionsSchema,assets:z.array(z.object({snapshot:snapshotSchema,source_path:z.string(),baseline_path:z.string().optional(),baseline_metrics:baselineMetricsSchema.optional(),parameters:z.record(z.string(),z.union([z.number(),z.boolean(),z.array(z.number())]))}).strict().refine(a=>Boolean(a.baseline_path)!==Boolean(a.baseline_metrics))).min(1).max(8)}).strict();
const argument=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error('collector_explicit_configuration_required');return process.argv[i+1];};
const preflight=process.argv.includes('--preflight');
if(preflight===process.argv.includes('--run-consented-experiment'))throw Error('collector_explicit_opt_in_required');
const policy=validateConsent(livePolicySchema.parse(JSON.parse(await readFile(argument('--consent-file'),'utf8'))));
if(preflight){process.stdout.write(JSON.stringify({consent_sha256:consentDigest(policy),normalized_policy:policy,protocol_sha256:policy.protocol_sha256,task_sha256:policy.task_sha256,schedule_sha256:policy.schedule_sha256})+'\n');process.exit(0);}
const manifest=manifestSchema.parse(JSON.parse(await readFile(argument('--manifest-file'),'utf8')));
let text='';for await(const chunk of process.stdin){text+=chunk.toString();if(Buffer.byteLength(text)>16384)throw Error('collector_input_excessive');}
const input=inputSchema.parse(JSON.parse(text));
if(input.consent_sha256!==consentDigest(policy)||input.protocol_sha256!==policy.protocol_sha256||input.task_sha256!==policy.task_sha256||input.schedule_sha256!==policy.schedule_sha256)throw Error('collector_consent_binding_mismatch');
// The evaluation collector kills this process at 75 s. If it is still alive 8 s after the request's own wall limit,
// report where it is stuck as a final content-free line and exit 3; the attempt stays failed either way.
const stall=armStallWatchdog(input.request.request_id,LIVE_LIMITS.wall_ms+8000,diagnostic=>{
 setTimeout(()=>process.exit(3),1000);
 process.stdout.write(JSON.stringify({schema_version:1,request_sha256:jsonDigest(input.request),collector_stall_diagnostic:diagnostic})+'\n',()=>process.exit(3));
});
const admission=new AdmissionGuard(manifest.admissions,['scored','setup']);admission.validate(policy,input.request);
// The manifest is private host input; neither model output nor the request can register paths.
const assets=new Map(manifest.assets.map(a=>[a.snapshot.session_id,a]));if(!assets.has(input.request.session_id))throw Error('collector_session_forbidden');
if(!process.env.AI_GATEWAY_API_KEY)throw Error('gateway_credentials_required');
const {GatewayProvider}=await import('./gateway-provider.ts');
const adapter=new NativeCliAdapter(manifest.executable,assets,manifest.work_directory);
const provider=new GatewayProvider(policy,process.env.AI_GATEWAY_API_KEY);
const service=new AssistantService(adapter,new StateStore(manifest.state_directory),provider,policy,undefined,undefined,admission);
const result=await service.run(input.request);
// Content-free shape facts for a rejected output stay outside the envelope that native and history validators check.
const latest=provider.lastOutputDiagnostic;
// A cancellation or timeout can win after an output failure; only the failure it explains carries it.
const diagnostic=latest?.request_id===input.request.request_id&&result.status==='failed'&&result.reason===`provider_output_${latest.category}_accounting_reserved`?latest:undefined;
process.stdout.write(JSON.stringify({schema_version:1,request_sha256:jsonDigest(input.request),result,...(diagnostic?{provider_output_diagnostic:diagnostic}:{}),...(result.preview?{private_preview_path:adapter.previewPath(input.request.session_id,result.preview.preview_id)}:{})})+'\n');
stall.output_written=true;
