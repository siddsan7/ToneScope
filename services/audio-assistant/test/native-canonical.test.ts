import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {canonicalJson,consentDigest} from '../agent/lib/live-policy.ts';
import {admissionsDigest,promptDigest} from '../agent/lib/live-admission.ts';
import {livePolicy} from './live-fixture.ts';

const executable=process.env.TONESCOPE_NATIVE_LIVE_GUARD??resolve('../../build/windows-dev/Release/live_desktop_tests.exe');
const required=process.env.TONESCOPE_REQUIRE_NATIVE_TESTS==='1';
const options={skip:!existsSync(executable)&&!required};
const admissions=[...Array.from({length:168},(_,i)=>({request_id:'scored_'+i,prompt_sha256:promptDigest('level'),role:'scored'})),
 ...Array.from({length:6},(_,i)=>({request_id:'setup_'+i,prompt_sha256:promptDigest('setup'),role:'setup'})),
 ...Array.from({length:6},(_,i)=>({request_id:'lifecycle_'+i,prompt_sha256:promptDigest('level'),role:'lifecycle'}))].sort((a,b)=>a.request_id<b.request_id?-1:a.request_id>b.request_id?1:0);
function configuration(directory:string,budget=1){
 const policy={...livePolicy(),budget_usd:budget,input_usd_per_million:0,output_usd_per_million:0,admissions_sha256:admissionsDigest(admissions)};
 return {schema_version:1,mode:'fault-injected',lifecycle_request_id:'lifecycle_0',policy,canonical_policy_json:canonicalJson(policy),consent_sha256:consentDigest(policy),admissions,state_directory:join(directory,'evaluation-state'),test_fetch_module:join(directory,'unused-test-only.mjs')};
}
const run=(args:string[])=>spawnSync(executable,args,{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});

test('real Node canonical policy bytes load in native across numeric representations',options,async()=>{
 assert.ok(existsSync(executable),'built native live guard required');const directory=await mkdtemp(join(process.cwd(),'.test-runtime-canonical-'));
 try{
  const numbers=[1,0.000001,1e-7,1e21,1000000000000000100,0.00288,9007199254740991];
  let state=0x123456789abcdefn;const bits=Buffer.alloc(8);
  while(numbers.length<519){state=BigInt.asUintN(64,state*6364136223846793005n+1442695040888963407n);bits.writeBigUInt64LE(state);const value=Math.abs(bits.readDoubleLE());if(Number.isFinite(value)&&value>=2.2250738585072014e-308)numbers.push(value);}
  const paths:string[]=[],expected:string[]=[];
  for(let i=0;i<numbers.length;i++){
   const value=configuration(directory,numbers[i]),path=join(directory,`${i}.json`);let text=JSON.stringify(value);
   if(i===0)text=text.replace('"budget_usd":1,','"budget_usd":1.0,');
   await writeFile(path,text);paths.push(path);expected.push(value.consent_sha256);
  }
  const index=join(directory,'index.json');await writeFile(index,JSON.stringify(paths));
  const result=run(['--config-list',index]);assert.equal(result.status,0,result.stderr);assert.deepEqual(result.stdout.trim().split(/\r?\n/),expected);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('native canonical receipt rejects altered text, policy, shape and underflowed budget',options,async()=>{
 assert.ok(existsSync(executable),'built native live guard required');const directory=await mkdtemp(join(process.cwd(),'.test-runtime-canonical-'));
 try{
  const base=configuration(directory),valid=join(directory,'valid.json');await writeFile(valid,JSON.stringify(base));assert.equal(run([valid]).status,0);
  const different=configuration(directory,2);
  const changedType={...base,policy:{...base.policy,max_requests:'180'}};
  const malformed=[{...base,state_directory:undefined},{...base,state_directory:'relative-state'},{...base,canonical_policy_json:base.canonical_policy_json+' '},
   {...base,canonical_policy_json:different.canonical_policy_json,consent_sha256:different.consent_sha256},
   {...base,canonical_policy_json:undefined},{...base,canonical_policy_json:'{'},
   {...base,canonical_policy_json:'x'.repeat(16385)},changedType,
   {...base,policy:{...base.policy,unexpected:true}},
   {...base,policy:{...base.policy,approved_data_classes:[...base.policy.approved_data_classes].reverse()}},
   configuration(directory,9.04506421984193e-309)];
  for(let i=0;i<malformed.length;i++){const path=join(directory,`bad-${i}.json`);await writeFile(path,JSON.stringify(malformed[i]));assert.equal(run([path]).status,1,`bad canonical receipt ${i}`);}
 }finally{await rm(directory,{recursive:true,force:true});}
});
