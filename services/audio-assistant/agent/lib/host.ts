import { readFile,writeFile,rename } from 'node:fs/promises';
import { z } from 'zod';
import { baselineMetricsSchema,snapshotSchema } from './contracts.ts';
import { NativeCliAdapter } from './native-cli.ts';
import { StateStore } from './store.ts';
import { GatewayProvider,livePolicySchema } from './gateway-provider.ts';
import { AssistantService } from './service.ts';
import { createBroker,listenLoopback } from './broker.ts';
// Private host-created manifest is the sole path registration surface;
// Never supplied by the model.
const config=z.object({executable:z.string(),work_directory:z.string(),state_directory:z.string(),live:livePolicySchema.optional(),port:z.number().int().min(0).max(65535).default(0),assets:z.array(z.object({snapshot:snapshotSchema,source_path:z.string(),baseline_path:z.string().optional(),baseline_metrics:baselineMetricsSchema.optional(),parameters:z.record(z.string(),z.union([z.number(),z.boolean(),z.array(z.number())]))}).strict().refine(a=>Boolean(a.baseline_path)!==Boolean(a.baseline_metrics))).max(8)}).strict();
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
const store=new StateStore(c.state_directory);for(const removed of await store.prune())await native.releasePreview(removed.session_hash,removed.preview_id);
const enableLive=process.env.TONESCOPE_ENABLE_LIVE==='1';
if(enableLive&&(!c.live||!process.env.AI_GATEWAY_API_KEY))throw Error('live_configuration_and_credentials_required');
const provider=enableLive?new GatewayProvider(c.live,process.env.AI_GATEWAY_API_KEY!):undefined;
const service=new AssistantService(native,store,provider,c.live);
const server=createBroker(service,store,token,new Set(assets.keys()));
const address=await listenLoopback(server,c.port);
const ready=JSON.stringify({schema_version:1,address,provider:enableLive?'gateway':'rules',live_enabled:enableLive});
const readyArgument=process.argv.indexOf('--native-ready-file');
if(readyArgument>=0){if(nativeArgument<0||!process.argv[readyArgument+1])throw Error('native_ready_file_not_authorized');const path=process.argv[readyArgument+1];await writeFile(path+'.tmp',ready,{mode:0o600,flag:'wx'});await rename(path+'.tmp',path);}else process.stdout.write(ready+'\n');
