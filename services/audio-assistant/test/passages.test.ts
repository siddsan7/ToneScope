import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import type {Snapshot} from '../agent/lib/contracts.ts';
import type {NativeAsset} from '../agent/lib/native-cli.ts';

// A worker checkout can reuse the explicitly selected, installed root runtime.
if(process.env.TONESCOPE_ASSISTANT_RUNTIME){const runtime=process.env.TONESCOPE_ASSISTANT_RUNTIME;
registerHooks({resolve(specifier,context,next){return next(specifier==='zod'?pathToFileURL(join(runtime,'node_modules/zod/index.js')).href:specifier,context);}});}
const {NativeCliAdapter}=await import('../agent/lib/native-cli.ts');
const {snapshotSchema,baselineMetricsSchema}=await import('../agent/lib/contracts.ts');
const executable=process.env.TONESCOPE_TEST_CLI;
if(process.env.TONESCOPE_REQUIRE_NATIVE_TESTS==='1'&&!executable)throw Error('required_native_cli_missing');
const signal=()=>new AbortController().signal;
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const db=(value:number)=>20*Math.log10(value);
const topology={compressor:false,multiband:false,equalizer:false,drive:false};
const value=(data:{measurement_id:string;value:number}[],id:string)=>{const found=data.find(m=>m.measurement_id===id);assert.ok(found,id);return found.value;};

async function fixture(softAmplitude=.04){
const dir=await mkdtemp(join(process.cwd(),'.test-runtime-passages-'));
const frames=19200,start=2400,end=16800,rate=48000;
const wav=Buffer.alloc(44+frames*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(3,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(32,34);wav.write('data',36);wav.writeUInt32LE(frames*4,40);
for(let n=0;n<frames;n++){
const amplitude=n>=4800&&n<7200?softAmplitude:n>=12000&&n<14400?.2:.7;
wav.writeFloatLE(amplitude*Math.sin(2*Math.PI*500*n/rate),44+n*4);
}
const source=join(dir,'source.wav'),baseline=join(dir,'baseline.wav');await writeFile(source,wav);
const manifest=JSON.parse(execFileSync(executable!,['render','--source',source,'--out',baseline,'--start',String(start),'--end',String(end)],{encoding:'utf8',windowsHide:true}));
const snapshot:Snapshot={session_id:'passage_session',session_revision:7,source_sha256:hash(wav),base_graph_sha256:manifest.graph_sha256,source_handle:'registered_source',selection_samples:[start,end],sample_rate:rate,parameters:[{stage_id:'output',parameter_id:'outputDb',unit:'dB',value:0,min:-24,max:24}],passages:{origin:'manual',soft:[4800,7200],hard:[12000,14400]},processing:{...topology}};
const asset:NativeAsset={snapshot,source_path:source,baseline_path:baseline,parameters:{outputDb:0}};
const assets=new Map([[snapshot.session_id,asset]]);
const adapter=new NativeCliAdapter(executable!,async()=>assets,join(dir,'previews'));
return {dir,source,baseline,snapshot,asset,assets,adapter};
}

test('passage schema requires manual, nonoverlapping contained ranges of at least two samples',()=>{
const base={session_id:'s',session_revision:0,source_sha256:'a'.repeat(64),base_graph_sha256:'b'.repeat(64),source_handle:'a',selection_samples:[100,1000],sample_rate:48000,parameters:[],passages:{origin:'manual',soft:[100,200],hard:[400,600]}};
assert.ok(snapshotSchema.safeParse(base).success);
for(const passages of [
{origin:'automatic',soft:[100,200],hard:[400,600]},
{origin:'manual',soft:[100,101],hard:[400,600]},
{origin:'manual',soft:[100,200],hard:[150,250]},
{origin:'manual',soft:[99,200],hard:[400,600]},
{origin:'manual',soft:[100,200],hard:[400,1001]},
{origin:'manual',soft:[100,200],hard:[400,600],inferred:true},
])assert.equal(snapshotSchema.safeParse({...base,passages}).success,false,JSON.stringify(passages));
assert.ok(snapshotSchema.safeParse({...base,passages:{origin:'manual',soft:[400,600],hard:[100,400]}}).success);
});

test('native cropped absolute passages measure correct intervals and candidate deltas; output gain behavior unchanged',{skip:!executable},async()=>{
const f=await fixture();try{
const baseline=await f.adapter.measurements(f.snapshot,signal());
assert.ok(Math.abs(value(baseline,'soft_rms_dbfs')-db(.04/Math.sqrt(2)))<1e-5);
assert.ok(Math.abs(value(baseline,'hard_rms_dbfs')-db(.2/Math.sqrt(2)))<1e-5);
assert.ok(Math.abs(value(baseline,'soft_peak_dbfs')-db(.04))<1e-5);
assert.ok(Math.abs(value(baseline,'hard_peak_dbfs')-db(.2))<1e-5);
assert.ok(Math.abs(value(baseline,'hard_soft_contrast_db')-db(5))<1e-5);
const preview=await f.adapter.render(f.snapshot,[{stage_id:'output',parameter_id:'outputDb',value:-3,unit:'dB'}],signal());
assert.ok(Math.abs(value(preview.measurements,'preview_soft_rms_dbfs')-value(baseline,'soft_rms_dbfs')+3)<1e-5);
assert.ok(Math.abs(value(preview.measurements,'preview_hard_rms_dbfs')-value(baseline,'hard_rms_dbfs')+3)<1e-5);
assert.ok(Math.abs(value(preview.measurements,'preview_hard_soft_contrast_db')-value(baseline,'hard_soft_contrast_db'))<1e-5);
const compared=await f.adapter.compare(f.snapshot,preview,signal());
for(const name of ['rms_delta_db','soft_rms_delta_db','hard_rms_delta_db'])assert.ok(Math.abs(value(compared,name)+3)<1e-5,name);
assert.ok(Math.abs(value(compared,'contrast_delta_db'))<1e-5);
const manifest=JSON.parse(await readFile(f.adapter.previewPath(f.snapshot.session_id,preview.preview_id)+'.json','utf8'));
assert.deepEqual(manifest.selection_samples,f.snapshot.selection_samples);
assert.equal(manifest.processed_frames,f.snapshot.selection_samples[1]);
}finally{await rm(f.dir,{recursive:true,force:true});}
});

test('silent passage omits RMS and contrast but reports the existing sample peak floor',{skip:!executable},async()=>{
const f=await fixture(0);try{
const baseline=await f.adapter.measurements(f.snapshot,signal());
assert.equal(value(baseline,'soft_peak_dbfs'),-240);
assert.ok(!baseline.some(m=>['soft_rms_dbfs','hard_soft_contrast_db'].includes(m.measurement_id)));
assert.ok(baseline.some(m=>m.measurement_id==='hard_rms_dbfs'));
const preview=await f.adapter.render(f.snapshot,[{stage_id:'output',parameter_id:'outputDb',value:-3,unit:'dB'}],signal());
assert.ok(!preview.measurements.some(m=>['preview_soft_rms_dbfs','preview_hard_soft_contrast_db'].includes(m.measurement_id)));
const compared=await f.adapter.compare(f.snapshot,preview,signal());
assert.ok(!compared.some(m=>['soft_rms_delta_db','contrast_delta_db'].includes(m.measurement_id)));
assert.ok(compared.some(m=>m.measurement_id==='hard_rms_delta_db'));
}finally{await rm(f.dir,{recursive:true,force:true});}
});

test('native RMS evidence floor omits subthreshold energy and retains measurable quiet passages',{skip:!executable},async()=>{
for(const amplitude of [5e-10,2e-9]){
const f=await fixture(amplitude);try{
const measured=await f.adapter.measurements(f.snapshot,signal());
const available=amplitude/Math.sqrt(2)>=1e-9;
assert.equal(measured.some(m=>m.measurement_id==='soft_rms_dbfs'),available);
assert.equal(measured.some(m=>m.measurement_id==='hard_soft_contrast_db'),available);
assert.ok(Number.isFinite(value(measured,'soft_peak_dbfs')));
}finally{await rm(f.dir,{recursive:true,force:true});}
}
});

test('missing passages preserves old measurements and metric-only passage evidence is explicitly unavailable',{skip:!executable},async()=>{
const f=await fixture();try{
const plain={...f.snapshot};delete plain.passages;delete plain.processing;
f.assets.set(plain.session_id,{...f.asset,snapshot:plain});
const result=await f.adapter.measurements(plain,signal());assert.deepEqual(result.map(m=>m.measurement_id),['rms_dbfs','peak_dbfs']);
const binding={session_id:f.snapshot.session_id,session_revision:f.snapshot.session_revision,source_sha256:f.snapshot.source_sha256,base_graph_sha256:f.snapshot.base_graph_sha256,selection_samples:f.snapshot.selection_samples,sample_rate:f.snapshot.sample_rate,passages:f.snapshot.passages,processing:f.snapshot.processing};
const metrics={rms:.1,peak:.7,alignment_samples:0 as const,binding};assert.ok(baselineMetricsSchema.safeParse(metrics).success);
f.assets.set(f.snapshot.session_id,{...f.asset,baseline_path:undefined,baseline_metrics:metrics});
await assert.rejects(f.adapter.measurements(f.snapshot,signal()),/passage_evidence_unavailable/);
f.assets.set(f.snapshot.session_id,{...f.asset,baseline_path:undefined,baseline_metrics:{...metrics,binding:{...binding,passages:{origin:'manual',soft:[4800,7200],hard:[12001,14400]}}}});
await assert.rejects(f.adapter.snapshot(f.snapshot.session_id,signal()),/baseline_binding_mismatch/);
}finally{await rm(f.dir,{recursive:true,force:true});}
});

test('native passage labels, topology, source/baseline/preview digests and revision bindings remain guarded',{skip:!executable},async()=>{
const f=await fixture();try{
const preview=await f.adapter.render(f.snapshot,[{stage_id:'output',parameter_id:'outputDb',value:-3,unit:'dB'}],signal());
for(const changed of [
{...f.snapshot,passages:{origin:'manual' as const,soft:[12000,14400] as [number,number],hard:[4800,7200] as [number,number]}},
{...f.snapshot,processing:{...topology,compressor:true}},
{...f.snapshot,session_revision:8}
]){
f.assets.set(f.snapshot.session_id,{...f.asset,snapshot:changed});
await assert.rejects(f.adapter.measurements(f.snapshot,signal()),/stale_native_asset/);
}
f.assets.set(f.snapshot.session_id,{...f.asset,snapshot:{...f.snapshot,processing:{...topology,compressor:true}}});
await assert.rejects(f.adapter.snapshot(f.snapshot.session_id,signal()),/processing_binding_mismatch/);
f.assets.set(f.snapshot.session_id,{...f.asset,parameters:{outputDb:0,drive:true}});
await assert.rejects(f.adapter.snapshot(f.snapshot.session_id,signal()),/processing_binding_mismatch/);
for(const passages of [
{origin:'manual' as const,soft:[4800,4801] as [number,number],hard:[12000,14400] as [number,number]},
{origin:'manual' as const,soft:[4800,13000] as [number,number],hard:[12000,14400] as [number,number]},
{origin:'manual' as const,soft:[0,7200] as [number,number],hard:[12000,14400] as [number,number]}
]){
f.assets.set(f.snapshot.session_id,{...f.asset,snapshot:{...f.snapshot,passages}});
await assert.rejects(f.adapter.snapshot(f.snapshot.session_id,signal()));
}
f.assets.set(f.snapshot.session_id,f.asset);
const originalSource=await readFile(f.source);await writeFile(f.source,Buffer.from('tamper'));
await assert.rejects(f.adapter.measurements(f.snapshot,signal()),/source_digest_mismatch/);await writeFile(f.source,originalSource);
const originalBaseline=await readFile(f.baseline);await writeFile(f.baseline,Buffer.from('tamper'));
await assert.rejects(f.adapter.measurements(f.snapshot,signal()),/baseline_digest_mismatch/);await writeFile(f.baseline,originalBaseline);
const path=f.adapter.previewPath(f.snapshot.session_id,preview.preview_id);await writeFile(path,Buffer.from('tamper'));
await assert.rejects(f.adapter.compare(f.snapshot,preview,signal()),/preview_binding/);
}finally{await rm(f.dir,{recursive:true,force:true});}
});
