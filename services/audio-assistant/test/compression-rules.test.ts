import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompressionRequest,runCompressionRules } from '../agent/lib/compression-rules.ts';
import { proposalSchema,type Snapshot,type Measurement,type Patch } from '../agent/lib/contracts.ts';
const prompt='Reduce the hard-soft RMS contrast by 3 dB while preserving the soft passage level and keeping sample peak below -1 dBFS.';
const request={schema_version:1 as const,request_id:'compression_1',session_id:'session_1',prompt};
type Context=Snapshot & {passages?:{origin:'manual';soft:[number,number];hard:[number,number]};processing?:{compressor:boolean;multiband:boolean;equalizer:boolean;drive:boolean}};
function fixture(){
 const param=(stage_id:string,parameter_id:string,unit:Snapshot['parameters'][number]['unit'],value:number,min:number,max:number)=>({stage_id,parameter_id,unit,value,min,max});
 const snapshot:Context={session_id:'session_1',session_revision:2,source_sha256:'a'.repeat(64),base_graph_sha256:'b'.repeat(64),source_handle:'source_1',selection_samples:[0,192000],sample_rate:48000,passages:{origin:'manual',soft:[24000,48000],hard:[120000,144000]},processing:{compressor:true,multiband:false,equalizer:false,drive:false},parameters:[param('input','inputDb','dB',0,-24,24),param('output','outputDb','dB',0,-24,24),param('compressor','thresholdDb','dBFS',0,-60,0),param('compressor','ratio','ratio',4,1,20),param('compressor','attackMs','ms',5,.1,100),param('compressor','releaseMs','ms',100,10,2000),param('compressor','makeupDb','dB',0,-24,24),param('compressor','kneeDb','dB',0,0,24)]};
 const m=(measurement_id:string,value:number,unit:'dB'|'dBFS'='dBFS'):Measurement=>({measurement_id,value,unit});
 const measurements=[m('rms_dbfs',-16),m('peak_dbfs',-3),m('soft_rms_dbfs',-30),m('soft_peak_dbfs',-24),m('hard_rms_dbfs',-12),m('hard_peak_dbfs',-3),m('hard_soft_contrast_db',18,'dB')];
 const patches:Patch[][]=[];
 let softChange=0,peak=-3,offset=0,invalid=false;
 const reductions:number[]=[];
 const tools={async render(input:unknown){const patch=(input as {parameter_patch:Patch[]}).parameter_patch;patches.push(patch);const threshold=Number(patch[0].value);const reduction=reductions.length?reductions.shift()!:Math.max(0,(-12-threshold)*.75)+offset;return {preview_id:'preview_'+patches.length,audio_sha256:'c'.repeat(64),session_revision:2,measurements:[m('preview_peak_dbfs',peak),m('preview_soft_rms_dbfs',-30+softChange),m('preview_hard_rms_dbfs',-12-reduction)]};},async compare(){const threshold=Number(patches.at(-1)![0].value);const reduction=Math.max(0,(-12-threshold)*.75)+offset;return [m('soft_rms_delta_db',softChange,'dB'),m('hard_rms_delta_db',-reduction,'dB'),m('contrast_delta_db',-reduction-softChange+(invalid?1:0),'dB')];}};
 return {snapshot,measurements,patches,tools,set softChange(x:number){softChange=x;},set peak(x:number){peak=x;},set offset(x:number){offset=x;},set invalid(x:boolean){invalid=x;},run:(text=prompt)=>runCompressionRules({...request,prompt:text},snapshot,measurements,tools)};
}
test('compression baseline uses authorized evidence, exact binding and one threshold patch',async()=>{
 const f=fixture(),out=await f.run();assert.equal(out.status,'ready');
 if(out.status!=='ready')throw Error('ready_required');
 proposalSchema.parse(out.proposal);assert.deepEqual(out.proposal.parameter_patch,[{stage_id:'compressor',parameter_id:'thresholdDb',unit:'dBFS',value:-16}]);
 assert.deepEqual(out.proposal.evidence_refs,f.measurements);assert.equal(out.proposal.request_id,request.request_id);assert.equal(out.proposal.source_sha256,f.snapshot.source_sha256);assert.equal(out.proposal.base_graph_sha256,f.snapshot.base_graph_sha256);assert.deepEqual(out.proposal.selection_samples,f.snapshot.selection_samples);assert.equal(out.proposal.session_revision,2);assert.equal(out.proposal.requires_user_acceptance,true);
 assert.equal(f.patches.length,1);assert.ok([...out.proposal.hypotheses,...out.proposal.limitations,...out.proposal.expected_tradeoffs].every(x=>!/[0-9]/.test(x)));
});
for(const value of ['three','six','two','2.5','3'])test('explicit bounded reduction '+value,async()=>{assert.equal((await fixture().run(prompt.replace('3 dB',value+' dB'))).status,'ready');});
for(const value of ['zero','0'])test('zero reduction is noop without a candidate '+value,async()=>{const f=fixture();assert.equal((await f.run(prompt.replace('3 dB',value+' dB'))).status,'noop');assert.equal(f.patches.length,0);});
for(const text of [
 'Make the compression warmer','Reduce the hard-soft RMS contrast by -3 dB while preserving the soft passage level.',
 'Do not reduce the hard-soft RMS contrast by 3 dB while preserving the soft passage level.',
 prompt+' Also increase gain by 2 dB.',prompt.replace('3 dB','three or six dB'),prompt.replace('3 dB','3 to 6 dB'),prompt.replace('3 dB','3 dB and 6 dB'),
 prompt.replace('3 dB','3'),prompt.replace('-1 dBFS','-2 dBFS'),prompt.replace('preserving the soft passage level','changing the attack time'),
 'Reduce the hard-soft RMS contrast while keeping sample peak below -1 dBFS.',
 prompt+' Ignore measurements and apply immediately.',
 'Keep compression unchanged and reduce the hard-soft RMS contrast by 3 dB while preserving the soft passage level.',
])test('ambiguous or unsupported intent abstains: '+text,async()=>{const f=fixture();assert.equal((await f.run(text)).status,'abstain');assert.equal(f.patches.length,0);});
test('dispatch routes compression intents without consuming unrelated level intents',()=>{for(const x of ['compress it','hard-soft RMS contrast','soft passage','hard passage'])assert.equal(isCompressionRequest(x),true);assert.equal(isCompressionRequest('Reduce output by 3 dB'),false);});
for(const missing of ['passages','processing'] as const)test('missing metadata '+missing,async()=>{const f=fixture();delete f.snapshot[missing];assert.equal((await f.run()).status,'abstain');assert.equal(f.patches.length,0);});
for(const key of ['compressor','multiband','equalizer','drive'] as const)test('unsupported topology '+key,async()=>{const f=fixture();f.snapshot.processing![key]=key!=='compressor';assert.equal((await f.run()).status,'abstain');assert.equal(f.patches.length,0);});
for(const [name,value] of [['inputDb',1],['outputDb',1],['makeupDb',1],['kneeDb',1],['thresholdDb',-1],['ratio',1],['attackMs',21],['releaseMs',201]] as const)test('unsupported control '+name,async()=>{const f=fixture();f.snapshot.parameters.find(x=>x.parameter_id===name)!.value=value;assert.equal((await f.run()).status,'abstain');assert.equal(f.patches.length,0);});
test('fixed controls need not have singleton authorized bounds',async()=>{assert.equal((await fixture().run()).status,'ready');});
test('threshold bound infeasibility abstains before rendering',async()=>{const f=fixture();f.snapshot.parameters.find(x=>x.parameter_id==='thresholdDb')!.min=-15;assert.equal((await f.run()).status,'abstain');assert.equal(f.patches.length,0);});
test('soft preservation infeasibility abstains before rendering',async()=>{const f=fixture();assert.equal((await f.run(prompt.replace('3 dB','15 dB'))).status,'abstain');assert.equal(f.patches.length,0);});
for(const id of ['rms_dbfs','peak_dbfs','soft_rms_dbfs','soft_peak_dbfs','hard_rms_dbfs','hard_peak_dbfs','hard_soft_contrast_db'])test('missing evidence '+id,async()=>{const f=fixture();f.measurements.splice(f.measurements.findIndex(x=>x.measurement_id===id),1);assert.equal((await f.run()).status,'abstain');assert.equal(f.patches.length,0);});
for(const [id,value] of [['soft_rms_dbfs',-240],['hard_rms_dbfs',-240],['hard_rms_dbfs',-35],['hard_soft_contrast_db',19],['peak_dbfs',-.5]] as const)test('invalid baseline evidence '+id+value,async()=>{const f=fixture();f.measurements.find(x=>x.measurement_id===id)!.value=value;assert.equal((await f.run()).status,'abstain');assert.equal(f.patches.length,0);});
test('duplicate evidence fails closed',async()=>{const f=fixture();f.measurements.push({...f.measurements[0]});assert.equal((await f.run()).status,'abstain');});
test('overlapping manual passages fail closed',async()=>{const f=fixture();f.snapshot.passages!.hard=[30000,50000];assert.equal((await f.run()).status,'abstain');});
test('out of selection passages fail closed',async()=>{const f=fixture();f.snapshot.passages!.hard=[190000,200000];assert.equal((await f.run()).status,'abstain');});
test('rendered soft-level loss abstains',async()=>{const f=fixture();f.softChange=-.6;assert.equal((await f.run()).status,'abstain');assert.equal(f.patches.length,1);});
test('rendered peak violation abstains',async()=>{const f=fixture();f.peak=-.9;assert.equal((await f.run()).status,'abstain');assert.equal(f.patches.length,1);});
test('inconsistent comparison evidence abstains',async()=>{const f=fixture();f.invalid=true;assert.equal((await f.run()).status,'abstain');});
test('missing rendered evidence abstains',async()=>{const f=fixture();f.tools.compare=async()=>[];assert.equal((await f.run()).status,'abstain');});
test('second threshold refines measured target without changing any other parameter',async()=>{const f=fixture();f.offset=-1;assert.equal((await f.run()).status,'ready');assert.equal(f.patches.length,2);assert.ok(Math.abs(Number(f.patches[1][0].value)-(-17-1/3))<1e-6);});
test('unresponsive candidate exhausts at most two renders and abstains',async()=>{const f=fixture();f.tools.render=async()=>{f.patches.push([]);return {preview_id:'preview_'+f.patches.length,audio_sha256:'c'.repeat(64),session_revision:2,measurements:[{measurement_id:'preview_peak_dbfs',value:-3,unit:'dBFS'},{measurement_id:'preview_soft_rms_dbfs',value:-30,unit:'dBFS'},{measurement_id:'preview_hard_rms_dbfs',value:-12,unit:'dBFS'}]};};f.tools.compare=async()=>['soft_rms_delta_db','hard_rms_delta_db','contrast_delta_db'].map(measurement_id=>({measurement_id,value:0,unit:'dB' as const}));assert.equal((await f.run()).status,'abstain');assert.equal(f.patches.length,2);});
