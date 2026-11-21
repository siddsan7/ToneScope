import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,unlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {LiveLedger} from '../agent/lib/live-ledger.ts';
import {livePolicy} from './live-fixture.ts';

test('loss of an initialized ledger cannot reset committed funds or admit another request',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-lost-budget-'));
 try{
  const policy={...livePolicy(),budget_usd:0.02};
  const binding={session_id:'loss_session',request_id:'loss_1',request_sha256:'a'.repeat(64)};
  const ledger=new LiveLedger(directory);
  await ledger.reserve(policy,binding,0.016);await ledger.generation(policy,binding);
  await ledger.settle(policy,binding,{known:true,cost_usd:0.015,input_tokens:12000,output_tokens:3000});
  const path=join(directory,'budget-v2.json');
  assert.equal(JSON.parse(await readFile(path,'utf8')).committed,0.015);
  await unlink(path);
  await assert.rejects(new LiveLedger(directory).reserve(policy,{...binding,request_id:'loss_2',request_sha256:'b'.repeat(64)},0.016),/budget_ledger_missing/);
  await assert.rejects(readFile(path),{code:'ENOENT'});
 }finally{await rm(directory,{recursive:true,force:true});}
});

for(const corruption of ['missing','malformed','mismatched'])test('used ledger fails closed with '+corruption+' identity marker',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-budget-identity-'));
 try{
  const policy=livePolicy(),binding={session_id:'identity',request_id:'first',request_sha256:'a'.repeat(64)};
  await new LiveLedger(directory).reserve(policy,binding,0.016);
  const path=join(directory,'budget-v2.identity.json'),before=await readFile(join(directory,'budget-v2.json'),'utf8');
  if(corruption==='missing')await unlink(path);
  else if(corruption==='malformed')await writeFile(path,'{}');
  else{const marker=JSON.parse(await readFile(path,'utf8'));marker.budget_id='different';await writeFile(path,JSON.stringify(marker));}
  await assert.rejects(new LiveLedger(directory).reserve(policy,{...binding,request_id:'second'},0.016),new RegExp(corruption==='missing'?'budget_identity_missing':corruption==='malformed'?'budget_identity_invalid':'budget_identity_conflict'));
  assert.equal(await readFile(join(directory,'budget-v2.json'),'utf8'),before);
 }finally{await rm(directory,{recursive:true,force:true});}
});

for(const point of ['zero_initialized','identity_created'])for(let repeat=1;repeat<=3;repeat++)test('killed bootstrap recovers without lost admissions: '+point+' '+repeat,async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-budget-bootstrap-'));
 const policy=livePolicy(),binding={session_id:'bootstrap',request_id:'first',request_sha256:'a'.repeat(64)};
 let child:ReturnType<typeof fork>|undefined;
 try{
  const config=join(directory,'config.json');await writeFile(config,JSON.stringify({directory,policy,binding,point}));
  child=fork(new URL('./fixtures/live-ledger-bootstrap.ts',import.meta.url),[config],{execArgv:['--experimental-strip-types'],stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('bootstrap_barrier_timeout')),15000);child!.once('message',()=>{clearTimeout(timer);resolve();});child!.once('exit',()=>{clearTimeout(timer);reject(Error('bootstrap_exited'));});});
  const stopped=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill('SIGKILL');await stopped;
  const zero=JSON.parse(await readFile(join(directory,'budget-v2.json'),'utf8'));assert.equal(zero.requests,0);assert.equal(zero.committed,0);assert.deepEqual(zero.records,{});
  const ledger=new LiveLedger(directory),owner=JSON.parse(await readFile(join(directory,'budget-v2.lock'),'utf8'));await ledger.recoverDeadLock(owner.nonce);
  const outcomes=await Promise.all([ledger.reserve(policy,binding,0.016),new LiveLedger(directory).reserve(policy,binding,0.016)]);
  assert.deepEqual(outcomes.sort(),[false,true]);
  const final=JSON.parse(await readFile(join(directory,'budget-v2.json'),'utf8'));assert.equal(final.requests,1);assert.equal(final.committed,0.016);assert.equal(final.generations,0);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const stopped=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill('SIGKILL');await stopped;}await rm(directory,{recursive:true,force:true});}
});
