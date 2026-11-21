import test from 'node:test';
import assert from 'node:assert/strict';
import {fork,execFileSync,type ChildProcess} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {LiveLedger} from '../agent/lib/live-ledger.ts';
import {livePolicy} from './live-fixture.ts';
const executable=process.env.TONESCOPE_TEST_CLI;
const evidence=process.env.TONESCOPE_P2_EVIDENCE;
const cases:unknown[]=[];
async function fixture(name:string){
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-recovery-')),frames=4800;
 const wav=Buffer.alloc(44+frames*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(3,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(192000,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(32,34);wav.write('data',36);wav.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++)wav.writeFloatLE(.04*Math.sin(i*440*2*Math.PI/48000),44+4*i);
 const source=join(directory,'source.wav'),baseline=join(directory,'baseline.wav');await writeFile(source,wav);
 const manifest=JSON.parse(execFileSync(executable!,['render','--source',source,'--out',baseline],{encoding:'utf8',windowsHide:true}));
 const snapshot={session_id:'session_1',session_revision:1,source_sha256:createHash('sha256').update(wav).digest('hex'),base_graph_sha256:manifest.graph_sha256,source_handle:'asset_1',selection_samples:[0,frames],sample_rate:48000,parameters:[{stage_id:'output',parameter_id:'outputDb',unit:'dB',value:0,min:-24,max:24}]};
 const config={executable,state:join(directory,'state'),work:join(directory,'previews'),calls:join(directory,'calls.jsonl'),assets:['session_1','session_2','session_3'].map(session_id=>({snapshot:{...snapshot,session_id},source_path:source,baseline_path:baseline,parameters:{outputDb:0}})),policy:livePolicy(),name};
 return {directory,config,cleanup:()=>rm(directory,{recursive:true,force:true})};
}
async function worker(directory:string,config:unknown){
 const file=join(directory,'config-'+Math.random()+'.json');await writeFile(file,JSON.stringify(config));
 const processChild=fork(resolve('test/fixtures/live-worker.ts'),[file],{execArgv:['--experimental-strip-types'],stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let output='';processChild.stderr!.on('data',b=>output+=b);const messages:any[]=[];const waiters:Array<{predicate:(m:any)=>boolean;resolve:(m:any)=>void}>=[];
 processChild.on('message',message=>{messages.push(message);for(const w of waiters)if(w.predicate(message))w.resolve(message);});
 const wait=(predicate:(m:any)=>boolean)=>new Promise<any>((res,rej)=>{const prior=messages.find(predicate);if(prior){res(prior);return;}const timer=setTimeout(()=>rej(Error('worker_wait_timeout '+output)),15000);const done=(m:any)=>{clearTimeout(timer);res(m);};waiters.push({predicate,resolve:done});processChild.once('exit',()=>{clearTimeout(timer);rej(Error('worker_exited '+output));});});
 const ready=await wait(m=>m.ready);const address='http://127.0.0.1:'+ready.ready.port;
 const request=(id='request_1',session='session_1')=>fetch(address+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+'t'.repeat(64),'content-type':'application/json'},body:JSON.stringify({schema_version:1,request_id:id,session_id:session,prompt:'increase gain by 3 dB'}),signal:AbortSignal.timeout(12000)}).then(async r=>({status:r.status,body:await r.json(),diagnostics:messages.filter(m=>m.safe_error)}));
 return {child:processChild,request,wait,address,policy:ready.policy,kill:()=>kill(processChild)};
}
async function kill(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise<void>(r=>child.once('exit',()=>r()));child.kill('SIGKILL');await exited;}
async function calls(path:string){try{return (await readFile(path,'utf8')).trim().split('\n').filter(Boolean).length;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;throw e;}}
const crashPoints=['load','reserve_after','generation_after','provider_during','render_after','settle_before','settle_after','history_after','ledger_lock_created','ledger_owner_written','ledger_before_commit','ledger_after_commit'];
for(const point of crashPoints)for(let repeat=1;repeat<=3;repeat++)test('subprocess actual broker/Gateway/native kill '+point+' repeat '+repeat,{skip:!executable},async()=>{
 const f=await fixture(point);let first:Awaited<ReturnType<typeof worker>>|undefined,restarted:Awaited<ReturnType<typeof worker>>|undefined;
 try{
  first=await worker(f.directory,{...f.config,barrier:point});const pending=first.request().catch(()=>undefined);await first.wait(m=>m.barrier===point);await first.kill();await pending;const before=await calls(f.config.calls);
  if(point.startsWith('ledger_')){
   const lock=join(f.config.state,'budget-v2.lock');let owner:any;try{owner=JSON.parse(await readFile(lock,'utf8'));}catch{}
   if(point==='ledger_lock_created'){
    // Empty owner cannot establish death. Recovery requires a stopped-broker operator review; no auto removal.
    restarted=await worker(f.directory,f.config);const blocked=await restarted.request();assert.equal(blocked.body.reason,'budget_ledger_lock_invalid');assert.equal(await calls(f.config.calls),before);await restarted.kill();restarted=undefined;
    await assert.rejects(new LiveLedger(f.config.state).recoverDeadLock('unknown'));
    cases.push({point,repeat,provenance:'fault-injected',before,after:before,outcome:'invalid_lock_fail_closed_operator_review_required'});return;
   }
   assert.ok(owner.nonce);await new LiveLedger(f.config.state).recoverDeadLock(owner.nonce);
  }
  restarted=await worker(f.directory,f.config);
  const response=await restarted.request();
  if(['load','ledger_owner_written','ledger_before_commit'].includes(point)){
   // No reservation was committed and no provider was called. This is a first admission after explicit dead-lock recovery.
   assert.equal(before,0);assert.equal(response.body.status,'ready',JSON.stringify(response));assert.equal(await calls(f.config.calls),2);
  }else{
   assert.ok(response.body.reason==='duplicate_request'||response.body.error==='invalid_or_failed_request',JSON.stringify(response));assert.equal(await calls(f.config.calls),before);
   // History deletion must not remove accounting tombstones.
   await fetch(restarted.address+'/v1/session?session_id=session_1',{method:'DELETE',headers:{authorization:'Bearer '+'t'.repeat(64)}});
   await restarted.kill();restarted=await worker(f.directory,f.config);const afterDelete=await restarted.request();assert.equal(afterDelete.body.reason,'duplicate_request');assert.equal(await calls(f.config.calls),before);
   await restarted.kill();restarted=await worker(f.directory,f.config);const rotated=await restarted.request('request_1','session_2');assert.equal(rotated.body.reason,'request_binding_conflict',JSON.stringify(rotated));assert.equal(await calls(f.config.calls),before);
  }
  const ledger=JSON.parse(await readFile(join(f.config.state,'budget-v2.json'),'utf8'));assert.equal(ledger.requests,1);assert.ok(ledger.committed>0);
  if(['reserve_after','generation_after','provider_during','render_after','settle_before','ledger_after_commit'].includes(point))assert.equal(ledger.committed,.016);
  cases.push({point,repeat,provenance:'fault-injected',before,after:await calls(f.config.calls),ledger_sha256:createHash('sha256').update(JSON.stringify(ledger)).digest('hex'),requests:ledger.requests,generations:ledger.generations,committed:ledger.committed,outcome:'pass'});
 }catch(error){cases.push({point,repeat,provenance:'fault-injected',outcome:'fail',reason:error instanceof Error?error.message:'unknown'});throw error;}finally{await first?.kill();await restarted?.kill();await f.cleanup();}
});
test('subprocess active-owner global and per-session admission, live lock cannot be stolen',{skip:!executable},async()=>{
 const f=await fixture('admission');const workers:Awaited<ReturnType<typeof worker>>[]=[];
 try{
  const a=await worker(f.directory,{...f.config,barrier:'provider_during'});workers.push(a);const pa=a.request('a','session_1').catch(()=>undefined);await a.wait(m=>m.barrier==='provider_during');
  const b=await worker(f.directory,{...f.config,barrier:'provider_during'});workers.push(b);const pb=b.request('b','session_2').catch(()=>undefined);await b.wait(m=>m.barrier==='provider_during');
  const third=await worker(f.directory,f.config);workers.push(third);assert.equal((await third.request('third','session_3')).body.error,'assistant_busy');assert.equal((await third.request('same','session_1')).body.error,'assistant_busy');assert.equal(await calls(f.config.calls),2);
  await a.kill();await b.kill();await pa;await pb;const afterDeath=await third.request('new','session_3');assert.equal(afterDeath.body.status,'ready',JSON.stringify(afterDeath));
  const held=await worker(f.directory,{...f.config,barrier:'ledger_owner_written'});workers.push(held);const pending=held.request('lock','session_2').catch(()=>undefined);await held.wait(m=>m.barrier==='ledger_owner_written');const owner=JSON.parse(await readFile(join(f.config.state,'budget-v2.lock'),'utf8'));await assert.rejects(new LiveLedger(f.config.state).recoverDeadLock(owner.nonce),/recovery_refused/);await held.kill();await pending;await new LiveLedger(f.config.state).recoverDeadLock(owner.nonce);
  cases.push({point:'global_per_session_and_owner',provenance:'fault-injected',outcome:'pass',two_sessions_dispatched:true,third_blocked:true,same_session_blocked:true,dead_inflight_slots_released:true,live_lock_recovery_refused:true});
 }finally{for(const w of workers)await w.kill();await f.cleanup();}
});
for(const ceiling of ['requests','generations','currency'] as const)test('subprocess '+ceiling+' ceiling survives contention and restart',{skip:!executable},async()=>{
 const f=await fixture('ceiling_'+ceiling);const workers:Awaited<ReturnType<typeof worker>>[]=[];
 try{
  const policy={...f.config.policy,...(ceiling==='requests'?{max_requests:1}:ceiling==='generations'?{max_generations:1}:{budget_usd:.02})};
  const config={...f.config,policy,noop:true,failTransport:ceiling==='currency'};const a=await worker(f.directory,config),b=await worker(f.directory,config);workers.push(a,b);
  const outcomes=await Promise.all([a.request('a','session_1'),b.request('b','session_2')]);assert.equal(outcomes.filter(x=>ceiling==='currency'?x.body.reason==='provider_call_failed_accounting_reserved':x.body.status==='noop').length,1,JSON.stringify(outcomes));const reason=ceiling==='requests'?'request_budget_exhausted':ceiling==='generations'?'generation_budget_exhausted':'currency_budget_exhausted';assert.equal(outcomes.filter(x=>x.body.reason===reason).length,1,JSON.stringify(outcomes));assert.equal(await calls(f.config.calls),1);
  await a.kill();await b.kill();const restarted=await worker(f.directory,config);workers.push(restarted);assert.equal((await restarted.request('third','session_3')).body.reason,reason);assert.equal(await calls(f.config.calls),1);
  const ledger=JSON.parse(await readFile(join(f.config.state,'budget-v2.json'),'utf8'));assert.equal(ledger.generations,1);assert.equal(ledger.requests,ceiling==='generations'?3:1);assert.ok(ledger.committed<=policy.budget_usd+1e-12);
  cases.push({point:'ceiling_'+ceiling,provenance:'fault-injected',outcome:'pass',calls:1,requests:ledger.requests,generations:ledger.generations});
 }finally{for(const w of workers)await w.kill();await f.cleanup();}
});
test.after(async()=>{if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'recovery-matrix.json'),JSON.stringify({schema_version:1,provenance:'fault-injected',provider_network_calls:0,native_executable:executable,native_sha256:executable?createHash('sha256').update(await readFile(executable)).digest('hex'):null,cases},null,2)+'\n');}});
