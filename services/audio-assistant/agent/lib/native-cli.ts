import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { readFile,mkdir,writeFile,rm } from 'node:fs/promises';
import { isAbsolute,join } from 'node:path';
import { z } from 'zod';
import { baselineMetricsSchema,snapshotSchema,type NativeAdapter,type Snapshot,type Patch,type Preview } from './contracts.ts';
export type NativeAsset={snapshot:Snapshot;
source_path:string;
baseline_path?:string;
baseline_metrics?:z.infer<typeof baselineMetricsSchema>;
parameters:Record<string,number|boolean|number[]>};
const finite=z.number().finite();
const comparison=z.object({valid:z.literal(true),dryRms:finite,wetRms:finite,gain:finite,residualRms:finite,peak:finite,gainCapped:z.boolean()});
const manifest=z.object({schema_version:z.literal(1),frames:z.number().int().positive(),channels:z.number().int().min(1).max(2),sample_rate_hz:finite,source_sha256:z.string(),artifact_sha256:z.string(),graph_sha256:z.string(),selection_samples:z.tuple([z.number(),z.number()]).optional(),processed_frames:z.number().int().positive().optional(),alignment_samples:z.union([z.literal(0),z.literal(32)]).optional()});
const digest=async(path:string,signal:AbortSignal)=>{const hash=createHash('sha256');
const stream=createReadStream(path,{signal,highWaterMark:65536});
for await(const chunk of stream){signal.throwIfAborted();
hash.update(chunk);
}return hash.digest('hex');
};
const db=(v:number)=>20*Math.log10(Math.max(1e-12,v));
/** All filesystem paths and executable selection come from trusted native host registration, never model input. */
export class NativeCliAdapter implements NativeAdapter {
 private previews=new Map<string,{path:string;
session:string;
revision:number}>();
 private executable:string;
private assets:ReadonlyMap<string,NativeAsset>|(()=>Promise<ReadonlyMap<string,NativeAsset>>);
private workDirectory:string;
constructor(executable:string,assets:ReadonlyMap<string,NativeAsset>|(()=>Promise<ReadonlyMap<string,NativeAsset>>),workDirectory:string){this.executable=executable;
this.assets=assets;
this.workDirectory=workDirectory;
if(!isAbsolute(executable)||!isAbsolute(workDirectory))throw Error('absolute_host_paths_required');
}
 private async invoke(args:string[],signal:AbortSignal):Promise<unknown>{signal.throwIfAborted();
return new Promise((resolve,reject)=>{execFile(this.executable,args,{shell:false,windowsHide:true,signal,timeout:55000,maxBuffer:65536},(error,stdout)=>{if(error){reject(Error(signal.aborted?'canceled':'native_cli_failed'));
return;
}try{resolve(JSON.parse(stdout));
}catch{reject(Error('native_invalid_json'));
}});
});
}
 private async asset(s:Snapshot){const assets=typeof this.assets==='function'?await this.assets():this.assets;
const a=assets.get(s.session_id);
if(!a||JSON.stringify(a.snapshot)!==JSON.stringify(s))throw Error('stale_native_asset');
return a;
}
 private async verify(a:NativeAsset,signal:AbortSignal){signal.throwIfAborted();
if(!isAbsolute(a.source_path)||(a.baseline_path&&!isAbsolute(a.baseline_path)))throw Error('absolute_host_paths_required');
if(await digest(a.source_path,signal)!==a.snapshot.source_sha256)throw Error('source_digest_mismatch');
if(!a.baseline_path){this.metrics(a);signal.throwIfAborted();return;}
const m=manifest.parse(JSON.parse(await readFile(a.baseline_path+'.json','utf8')));
if(m.source_sha256!==a.snapshot.source_sha256||m.graph_sha256!==a.snapshot.base_graph_sha256||await digest(a.baseline_path,signal)!==m.artifact_sha256)throw Error('baseline_digest_mismatch');
const selected=m.selection_samples??[0,m.frames];
if(JSON.stringify(selected)!==JSON.stringify(a.snapshot.selection_samples)||m.frames!==selected[1]-selected[0])throw Error('baseline_selection_mismatch');
if(m.sample_rate_hz!==a.snapshot.sample_rate)throw Error('sample_rate_mismatch');
signal.throwIfAborted();
}
 private metrics(a:NativeAsset){
 const m=baselineMetricsSchema.parse(a.baseline_metrics);const expected={session_id:a.snapshot.session_id,session_revision:a.snapshot.session_revision,source_sha256:a.snapshot.source_sha256,base_graph_sha256:a.snapshot.base_graph_sha256,selection_samples:a.snapshot.selection_samples,sample_rate:a.snapshot.sample_rate};
 if(a.baseline_path||JSON.stringify(m.binding)!==JSON.stringify(expected))throw Error('baseline_binding_mismatch');
 const alignment=a.parameters.drive===true&&Number(a.parameters.oversampling??1)>1?32:0;if(m.alignment_samples!==alignment)throw Error('baseline_alignment_mismatch');return m;
 }
 async snapshot(session:string,signal:AbortSignal){const assets=typeof this.assets==='function'?await this.assets():this.assets;
const a=assets.get(session);
if(!a)throw Error('unauthorized_session');
snapshotSchema.parse(a.snapshot);
await this.verify(a,signal);
return structuredClone(a.snapshot);
}
 async measurements(s:Snapshot,signal:AbortSignal){const a=await this.asset(s);
await this.verify(a,signal);
const measured=a.baseline_path?z.object({rms:finite,peak:finite}).parse(await this.invoke(['inspect','--source',a.baseline_path],signal)):this.metrics(a);
return [{measurement_id:'rms_dbfs',value:db(measured.rms),unit:'dBFS'},{measurement_id:'peak_dbfs',value:db(measured.peak),unit:'dBFS'}];
}
 async renderFrameCost(s:Snapshot,signal:AbortSignal){const a=await this.asset(s);
await this.verify(a,signal);
if(!a.baseline_path)return s.selection_samples[1]+this.metrics(a).alignment_samples;
const m=manifest.parse(JSON.parse(await readFile(a.baseline_path+'.json','utf8')));
return s.selection_samples[1]+(m.alignment_samples??0);
}
 async render(s:Snapshot,patch:Patch[],signal:AbortSignal){const a=await this.asset(s);
await this.verify(a,signal);
const parameters={...a.parameters};
for(const p of patch){if(!s.parameters.some(x=>x.stage_id===p.stage_id&&x.parameter_id===p.parameter_id&&x.unit===p.unit))throw Error('unauthorized_parameter');
parameters[p.parameter_id]=p.value;
}await mkdir(this.workDirectory,{recursive:true});
const preview_id=randomUUID();
const folder=join(this.workDirectory,preview_id);
await mkdir(folder,{mode:0o700});
const output=join(folder,'preview.wav');
const config=join(folder,'session.json');
try{await writeFile(config,JSON.stringify({schema_version:1,source_sha256:s.source_sha256,parameters}),{mode:0o600,flag:'wx'});
const m=manifest.parse(await this.invoke(['render','--source',a.source_path,'--out',output,'--session',config,'--block-size','257',...((!a.baseline_path||s.selection_samples[0]!==0||Array.isArray(JSON.parse(await readFile(a.baseline_path+'.json','utf8')).selection_samples))?['--start',String(s.selection_samples[0]),'--end',String(s.selection_samples[1])]:[])],signal));
if((m.processed_frames??m.frames)!==await this.renderFrameCost(s,signal)||m.frames!==s.selection_samples[1]-s.selection_samples[0]||m.sample_rate_hz!==s.sample_rate||m.source_sha256!==s.source_sha256||await digest(output,signal)!==m.artifact_sha256)throw Error('preview_manifest_mismatch');
const measured=z.object({rms:finite,peak:finite}).parse(await this.invoke(['inspect','--source',output],signal));
signal.throwIfAborted();
this.previews.set(preview_id,{path:output,session:s.session_id,revision:s.session_revision});
return {preview_id,audio_sha256:m.artifact_sha256,session_revision:s.session_revision,measurements:[{measurement_id:'preview_rms_dbfs',value:db(measured.rms),unit:'dBFS'},{measurement_id:'preview_peak_dbfs',value:db(measured.peak),unit:'dBFS'}]};
}catch(e){await rm(folder,{recursive:true,force:true});
throw e;
}finally{await rm(config,{force:true});
}}
 async compare(s:Snapshot,p:Preview,signal:AbortSignal){const a=await this.asset(s);
await this.verify(a,signal);
const found=this.previews.get(p.preview_id);
if(!found||found.session!==s.session_id||found.revision!==s.session_revision||await digest(found.path,signal)!==p.audio_sha256)throw Error('preview_binding');
if(!a.baseline_path){const measured=z.object({rms:finite,peak:finite}).parse(await this.invoke(['inspect','--source',found.path],signal));return [{measurement_id:'rms_delta_db',value:db(measured.rms)-db(this.metrics(a).rms),unit:'dB'}];}
const m=comparison.parse(await this.invoke(['compare','--dry',a.baseline_path,'--wet',found.path,'--start','0','--end',String(s.selection_samples[1]-s.selection_samples[0])],signal));
return [{measurement_id:'rms_delta_db',value:db(m.wetRms)-db(m.dryRms),unit:'dB'},{measurement_id:'residual_rms_dbfs',value:db(m.residualRms),unit:'dBFS'}];
}
 async verifyPreview(s:Snapshot,p:Preview,signal:AbortSignal){await this.asset(s);
signal.throwIfAborted();
const found=this.previews.get(p.preview_id);
if(!found||found.session!==s.session_id||found.revision!==s.session_revision||await digest(found.path,signal)!==p.audio_sha256)throw Error('preview_binding');
signal.throwIfAborted();
}
 /** Native preview playback resolves only opaque IDs in this host-owned map. */
 previewPath(session:string,preview:string){const p=this.previews.get(preview);
if(!p||p.session!==session)throw Error('unknown_preview');
return p.path;
}
 async deleteSession(session:string){for(const [id,p] of this.previews)if(p.session===session){this.previews.delete(id);
await rm(join(this.workDirectory,id),{recursive:true,force:true});
}}
}
