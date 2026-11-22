import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {armStallWatchdog,stallDiagnostic} from '../agent/lib/live-stall.ts';
import {LiveLedger,ledgerProgress,type LedgerBarrier} from '../agent/lib/live-ledger.ts';
import {LIVE_PROTOCOL_SHA256,LIVE_LIMITS,type LivePolicy} from '../agent/lib/live-policy.ts';

const policy=():LivePolicy=>({schema_version:1,consent:true,currency:'USD',budget_usd:1,experiment_id:'experiment_1',budget_id:'budget_1',protocol_sha256:LIVE_PROTOCOL_SHA256,limits:{...LIVE_LIMITS},task_sha256:'b'.repeat(64),schedule_sha256:'c'.repeat(64),admissions_sha256:'a'.repeat(64),metadata_sha256:'d'.repeat(64),verified_model:'test/model',provider_slug:'test',verified_at:new Date().toISOString(),input_usd_per_million:1,output_usd_per_million:1,pricing_source:'https://ai-gateway.vercel.sh/v1/models',max_requests:180,max_generations:1440,approved_data_classes:['request_text','scalar_measurements','authorized_controls','identity_metadata']});

test('stall diagnostic keeps only bounded, content-free facts',()=>{
 const diagnostic=stallDiagnostic('request_1',68012.6,'lock_owner_sync',false,['FSReqPromise','FSReqPromise','Timeout','C:\\private\\path','PRIVATE CANARY']);
 assert.deepEqual(diagnostic,{schema_version:1,request_id:'request_1',elapsed_ms:68013,ledger_step:'lock_owner_sync',output_written:false,active_resources:{FSReqPromise:2,Timeout:1,other:2}});
 assert.equal(stallDiagnostic('r',-5,'C:\\private',true,[]).ledger_step,'other');
 assert.equal(stallDiagnostic('r',9e9,'idle',true,[]).elapsed_ms,600000);
 assert.equal(Object.keys(stallDiagnostic('r',1,'idle',false,Array.from({length:60},(_,i)=>'Kind'+String.fromCharCode(65+i%26)+String.fromCharCode(65+Math.floor(i/26)))).active_resources).length,32);
});

test('ledger records the filesystem step it last started and returns to idle',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-stall-'));
 try{
  const seen:Partial<Record<LedgerBarrier,string>>={};
  const ledger=new LiveLedger(directory,async point=>{seen[point]=ledgerProgress.step;});
  assert.equal(await ledger.reserve(policy(),{session_id:'session_1',request_id:'request_1',request_sha256:'e'.repeat(64)},0.01),true);
  assert.equal(seen.lock_created,'lock_acquire');
  assert.equal(seen.owner_written,'lock_owner_sync');
  assert.equal(seen.before_commit,'temp_close');
  assert.equal(seen.after_commit,'commit_rename');
  assert.equal(ledgerProgress.step,'idle');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('watchdog fires only in a process kept alive by a stuck handle, and never keeps a finished one alive',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-stall-'));
 try{
  const library=pathToFileURL(resolve('agent/lib/live-stall.ts')).href;
  const script=(stuck:boolean)=>`import {armStallWatchdog} from ${JSON.stringify(library)};
const stall=armStallWatchdog('request_1',300,diagnostic=>{process.stdout.write(JSON.stringify({collector_stall_diagnostic:diagnostic})+'\\n',()=>process.exit(3));});
process.stdout.write('{"result":"written"}\\n');stall.output_written=true;
${stuck?'setInterval(()=>{},1000);':''}`;
  const run=async(stuck:boolean)=>{const file=join(directory,stuck?'stuck.mjs':'clean.mjs');await writeFile(file,script(stuck));return spawnSync(process.execPath,['--experimental-strip-types',file],{encoding:'utf8',timeout:20000});};
  const clean=await run(false);
  assert.equal(clean.status,0,clean.stderr);assert.equal(clean.stdout,'{"result":"written"}\n');
  const stuck=await run(true);
  assert.equal(stuck.status,3,stuck.stderr);
  const lines=stuck.stdout.trim().split('\n');assert.equal(lines.length,2);
  const diagnostic=JSON.parse(lines[1]).collector_stall_diagnostic;
  assert.equal(diagnostic.request_id,'request_1');assert.equal(diagnostic.output_written,true);assert.equal(diagnostic.ledger_step,'idle');
  assert.ok(diagnostic.elapsed_ms>=300&&diagnostic.elapsed_ms<15000);assert.ok(diagnostic.active_resources.Timeout>=1,JSON.stringify(diagnostic));
 }finally{await rm(directory,{recursive:true,force:true});}
});
