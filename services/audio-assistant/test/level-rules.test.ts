import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AssistantService } from '../agent/lib/service.ts';
import { StateStore } from '../agent/lib/store.ts';
import type { NativeAdapter,Snapshot } from '../agent/lib/contracts.ts';

// Separate generalization cases: never read the frozen experiment manifest.
type Case={prompt:string;status:string;value?:number;rms?:number;peak?:number|null;current?:number;min?:number;max?:number};
const cases:Case[]=[
  {prompt:'Make this passage louder',status:'ready',value:6},
  {prompt:'Reduce the noise.',status:'abstain'},
  {prompt:'Reduce noise by 3 dB.',status:'abstain'},
  {prompt:'Make it louder than the reference.',status:'abstain'},
  {prompt:'Make it louder and remove the background hiss.',status:'abstain'},
  {prompt:'Normalize the level and remove noise.',status:'abstain'},
  {prompt:'Keep the noise unchanged.',status:'abstain'},
  {prompt:'Reduce level by 3 dB and improve clarity.',status:'abstain'},
  {prompt:'Please turn the volume down by 2.75 decibels.',status:'ready',value:-2.75},
  {prompt:'Boost the gain by four dB.',status:'ready',value:4},
  {prompt:'Raise this by twenty-one dB.',rms:-40,peak:-30,status:'ready',value:21},
  {prompt:'Adjust output gain by -1.25 dB.',current:4,status:'ready',value:2.75},
  {prompt:'Make it 0.5 dB softer.',current:-2,status:'ready',value:-2.5},
  {prompt:'Bring RMS to -21.5 dBFS.',rms:-25,current:2,status:'ready',value:5.5},
  {prompt:'Normalize to minus twenty-seven dBFS.',rms:-25,status:'ready',value:-2},
  {prompt:'Maximize volume without sample peak exceeding -2.5 dBFS.',peak:-8,current:3,status:'ready',value:8.5},
  {prompt:'Keep the output as is.',status:'noop'},
  {prompt:'Leave the level unchanged.',rms:-240,status:'noop'},
  {prompt:'Increase gain by zero dB.',status:'noop'},
  {prompt:'Normalize RMS to -25 dBFS.',rms:-25.0000003,status:'noop'},
  {prompt:'As loud as possible without peak exceeding -1 dBFS.',peak:-1.0000003,status:'noop'},
  {prompt:'Increase gain by 4 dB.',max:2,status:'abstain'},
  {prompt:'Reduce level by 4 dB.',current:-3,min:-5,status:'abstain'},
  {prompt:'Normalize RMS to -12 dBFS.',rms:-30,peak:-9,status:'abstain'},
  {prompt:'Make louder.',peak:0,status:'abstain'},
  {prompt:'Maximize volume without peak exceeding -10 dBFS.',peak:-1,min:-3,status:'abstain'},
  {prompt:'Boost level by 2 dB.',peak:null,status:'abstain'},
  {prompt:'Maximize volume.',peak:null,status:'abstain'},
  {prompt:'Normalize level.',rms:-240,status:'abstain'},
  {prompt:'Raise and lower gain by 2 dB.',status:'abstain'},
  {prompt:'Reduce level by -2 dB.',status:'abstain'},
  {prompt:'Set gain to 3 dB.',status:'abstain'},
  {prompt:'Raise gain to 3 dB.',status:'abstain'},
  {prompt:'Increase gain by 2 dB then reduce by 1 dB.',status:'abstain'},
  {prompt:'Normalize RMS to -20 dBFS and -22 dBFS.',status:'abstain'},
  {prompt:'Boost level by banana dB.',status:'abstain'},
  {prompt:'Do not increase the gain.',status:'abstain'},
  {prompt:'Make it louder and warmer.',status:'abstain'},
  {prompt:'Normalize to -18 LUFS.',status:'abstain'},
  {prompt:'Keep the level unchanged and boost by 2 dB.',status:'abstain'},
  {prompt:'Do not turn the level up.',status:'abstain'},
  {prompt:'Do not make it louder.',status:'abstain'},
  {prompt:'Increase the level by 1e3 dB.',status:'abstain'},
  {prompt:'Increase the level by 1,000 dB.',status:'abstain'},
  {prompt:'Increase the level by 12 000 dB.',status:'abstain'},
  {prompt:'Keep the level unchanged and keep sample peak below -20 dBFS.',status:'abstain'},
  {prompt:'Make the level as loud as the reference.',status:'abstain'},
  {prompt:'Make it as loud as the original recording.',status:'abstain'},
  {prompt:'Reduce gain by 4.',status:'abstain'},
  {prompt:'Increase gain by 2 kHz.',status:'abstain'},
  {prompt:'Reduce gain by 2 dB.',peak:null,status:'abstain'},
  {prompt:'Make it no louder.',status:'abstain'},
  {prompt:'Avoid making it louder.',status:'abstain'},
  {prompt:'Please use RMS measurements to make a decision.',status:'abstain'},
  {prompt:'Reduce level by 3 dB and keep sample peak not below -1 dBFS.',status:'abstain'},
  {prompt:'Reduce level by 3 dB and keep sample peak above -1 dBFS.',status:'abstain'},
  {prompt:'Bring RMS to -23 dBFS without sample peak exceeding -2 dBFS.',status:'ready',value:2},
];
for(const c of cases)test('rules generalization: '+c.prompt,async()=>{
  const dir=await mkdtemp(join(process.cwd(),'.test-level-rules-'));
  let renders=0;
  const snapshot:Snapshot={session_id:'rules_generalization',session_revision:1,source_sha256:'a'.repeat(64),base_graph_sha256:'b'.repeat(64),source_handle:'source',selection_samples:[0,1000],sample_rate:48000,
    parameters:[{stage_id:'output',parameter_id:'outputDb',unit:'dB',value:c.current??0,min:c.min??-24,max:c.max??24}]};
  const adapter:NativeAdapter={async snapshot(){return snapshot;},async measurements(){return [
    {measurement_id:'rms_dbfs',value:c.rms??-25,unit:'dBFS'},
    ...(c.peak===null?[]:[{measurement_id:'peak_dbfs',value:c.peak??-8,unit:'dBFS' as const}])];},
    async render(){renders++;return {preview_id:'candidate',audio_sha256:'c'.repeat(64),session_revision:1,measurements:[{measurement_id:'preview_rms_dbfs',value:-20,unit:'dBFS'}]};},async compare(){return [];}};
  try {
    const out=await new AssistantService(adapter,new StateStore(dir)).run({schema_version:1,request_id:'case',session_id:snapshot.session_id,prompt:c.prompt});
    assert.equal(out.status,c.status,JSON.stringify(out));
    assert.equal(renders,c.status==='ready'?1:0);
    assert.equal(out.usage.cost_usd,0);
    if(c.value!==undefined){assert.ok(out.proposal);assert.ok(Math.abs(Number(out.proposal.parameter_patch[0].value)-c.value)<1e-9);assert.equal(out.proposal.requires_user_acceptance,true);}
  }finally{await rm(dir,{recursive:true,force:true});}
});
