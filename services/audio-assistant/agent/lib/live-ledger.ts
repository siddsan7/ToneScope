import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {consentDigest,validateConsent,livePolicySchema,type LivePolicy} from './live-policy.ts';
import {replaceAtomically} from './atomic-replace.ts';
import {openExclusive} from './exclusive-open.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const amount=z.number().finite().nonnegative();
const count=z.number().int().safe().nonnegative();
const bindingSchema=z.object({session_id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),request_id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),request_sha256:hash}).strict();
export type LiveBinding=z.infer<typeof bindingSchema>;
const settlementSchema=z.object({cost_usd:amount,input_tokens:count.max(12000),output_tokens:count.max(4000),known:z.boolean()}).strict();
export type Settlement=z.infer<typeof settlementSchema>;
const ownerSchema=z.object({pid:z.number().int().positive(),nonce:z.string().uuid()}).strict();
const requestRecord=z.object({binding:bindingSchema,reserved_usd:amount,phase:z.enum(['reserved','dispatched','terminal']),generations:count,owner:ownerSchema.nullable(),terminal:settlementSchema.nullable()}).strict();
const ledgerSchema=z.object({schema_version:z.literal(2),consent_sha256:hash,budget_id:z.string(),committed:amount,requests:count,generations:count,records:z.record(hash,requestRecord)}).strict();
const identitySchema=z.object({schema_version:z.literal(1),budget_id:z.string(),consent_sha256:hash}).strict();
type Ledger=z.infer<typeof ledgerSchema>;
const key=(b:LiveBinding)=>createHash('sha256').update(b.session_id+'\0'+b.request_id).digest('hex');
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}};
/** Last ledger filesystem step started in this process. Read only by the collector's stall watchdog; never affects control flow. */
export const ledgerProgress={step:'idle'};
/** Process-kill durability only. Unknown reservations are never refunded. */
export type LedgerBarrier='lock_created'|'owner_written'|'zero_initialized'|'identity_created'|'before_commit'|'after_commit';
export class LiveLedger{
 constructor(privateDirectory:string,barrier?:(point:LedgerBarrier)=>Promise<void>){this.directory=privateDirectory;this.barrier=barrier;}
 private barrier?: (point:LedgerBarrier)=>Promise<void>;
 private directory:string;
 private async transaction<T>(policy:LivePolicy,operation:(ledger:Ledger)=>T,existingOnly=false):Promise<T>{
  const p=existingOnly?livePolicySchema.parse(policy):validateConsent(policy);ledgerProgress.step='directory_create';await mkdir(this.directory,{recursive:true});
  const lockPath=join(this.directory,'budget-v2.lock');const owner={pid:process.pid,nonce:randomUUID()};let lock;
  // Never steal locks. A dead owner requires explicit recoverDeadLock after verifying its identity.
  ledgerProgress.step='lock_acquire';
  for(let attempt=0;attempt<100;attempt++){
   try{lock=await openExclusive(lockPath);break;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;let prior;
    try{prior=ownerSchema.parse(JSON.parse(await readFile(lockPath,'utf8')));}catch{if(attempt===99)throw Error('budget_ledger_lock_invalid');}
    if(prior&&!alive(prior.pid))throw Error('budget_ledger_dead_owner');if(attempt===99)throw Error('budget_ledger_locked');
    await new Promise(r=>setTimeout(r,10));
   }
  }
  if(!lock)throw Error('budget_ledger_locked');
  try{await this.barrier?.('lock_created');ledgerProgress.step='lock_owner_write';await lock.writeFile(JSON.stringify(owner));ledgerProgress.step='lock_owner_sync';await lock.sync();await this.barrier?.('owner_written');ledgerProgress.step='legacy_read';
   try{await readFile(join(this.directory,'budget.json'));throw Error('legacy_budget_requires_review');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   const path=join(this.directory,'budget-v2.json'),identityPath=join(this.directory,'budget-v2.identity.json');let ledger:Ledger,identity:z.infer<typeof identitySchema>|undefined,missing=false;ledgerProgress.step='identity_read';
   try{identity=identitySchema.parse(JSON.parse(await readFile(identityPath,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('budget_identity_invalid');}
   if(identity&&(identity.consent_sha256!==consentDigest(p)||identity.budget_id!==p.budget_id))throw Error('budget_identity_conflict');
   ledgerProgress.step='ledger_read';try{ledger=ledgerSchema.parse(JSON.parse(await readFile(path,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){if(identity)throw Error('budget_ledger_missing');missing=true;ledger={schema_version:2,consent_sha256:consentDigest(p),budget_id:p.budget_id,committed:0,requests:0,generations:0,records:{}};}else throw Error('budget_ledger_invalid');}
   if(ledger.consent_sha256!==consentDigest(p)||ledger.budget_id!==p.budget_id)throw Error('budget_identity_conflict');
   const records=Object.values(ledger.records);const committed=records.reduce((sum,r)=>sum+(r.terminal?.known?r.terminal.cost_usd:r.reserved_usd),0);
   if(new Set(records.map(r=>r.binding.request_id)).size!==records.length||ledger.requests!==records.length||ledger.generations!==records.reduce((n,r)=>n+r.generations,0)||Math.abs(committed-ledger.committed)>1e-10||ledger.requests>p.max_requests||ledger.generations>p.max_generations||ledger.committed>p.budget_usd+1e-12||Object.entries(ledger.records).some(([k,r])=>k!==key(r.binding)||(r.phase==='terminal')!==Boolean(r.terminal)||(r.phase==='terminal'&&r.owner!==null)||(r.phase==='reserved'&&r.generations!==0)||(r.phase==='dispatched'&&r.generations===0)||r.generations>8||(r.terminal&&(r.terminal.cost_usd>r.reserved_usd+1e-12||(!r.terminal.known&&r.terminal.cost_usd!==r.reserved_usd)))))throw Error('budget_ledger_invalid');
   if(!identity){
    if(records.length||ledger.requests||ledger.generations||ledger.committed)throw Error('budget_identity_missing');
    // Persist the validated empty ledger first. A killed bootstrap can finish only while it is still empty.
    if(missing)await this.writeLedger(path,ledger);
    await this.barrier?.('zero_initialized');
    const marker=await open(identityPath,'wx',0o600);
    try{await marker.writeFile(JSON.stringify({schema_version:1,budget_id:p.budget_id,consent_sha256:consentDigest(p)}));await marker.sync();}finally{await marker.close();}
    await this.barrier?.('identity_created');
   }
   for(const r of records)if(r.owner&&!alive(r.owner.pid))r.owner=null;
   const result=operation(ledger);const temp=path+'.'+randomUUID()+'.tmp';
   try{ledgerProgress.step='temp_open';const file=await open(temp,'wx',0o600);try{ledgerProgress.step='temp_write';await file.writeFile(JSON.stringify(ledger));ledgerProgress.step='temp_sync';await file.sync();}finally{ledgerProgress.step='temp_close';await file.close();}await this.barrier?.('before_commit');ledgerProgress.step='commit_rename';await replaceAtomically(temp,path);await this.barrier?.('after_commit');}finally{ledgerProgress.step='temp_unlink';await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
   return result;
  }finally{ledgerProgress.step='lock_close';await lock.close();ledgerProgress.step='lock_unlink';await unlink(lockPath);ledgerProgress.step='idle';}
 }
 private async writeLedger(path:string,ledger:Ledger){
  const temp=path+'.'+randomUUID()+'.tmp';
  try{const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(ledger));await file.sync();}finally{await file.close();}await replaceAtomically(temp,path);}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 /** Operator recovery only: expected nonce prevents removing an unrelated lock. Call while brokers are stopped. */
 async recoverDeadLock(expectedNonce:string){
  // Serialize operators too: two recoveries must not unlink a newly acquired live lock.
  const recoveryPath=join(this.directory,'budget-v2.recovery.lock');let recovery;
  try{recovery=await open(recoveryPath,'wx',0o600);}catch{throw Error('budget_lock_recovery_locked');}
  try{await recovery.writeFile(JSON.stringify({pid:process.pid,nonce:randomUUID()}));await recovery.sync();const path=join(this.directory,'budget-v2.lock');const owner=ownerSchema.parse(JSON.parse(await readFile(path,'utf8')));if(owner.nonce!==expectedNonce||alive(owner.pid))throw Error('budget_lock_recovery_refused');await unlink(path);}
  finally{await recovery.close();await unlink(recoveryPath);}
 }
 async reserve(policy:LivePolicy,binding:LiveBinding,reserved:number,limits={global:2,per_session:1}){binding=bindingSchema.parse(binding);if(!Number.isFinite(reserved)||reserved<0||!Number.isInteger(limits.global)||limits.global<1||limits.global>2||limits.per_session!==1)throw Error('budget_reservation_invalid');return this.transaction(policy,l=>{const k=key(binding),prior=l.records[k];if(prior){if(JSON.stringify(prior.binding)!==JSON.stringify(binding)||prior.reserved_usd!==reserved)throw Error('request_binding_conflict');return false;}if(Object.values(l.records).some(r=>r.binding.request_id===binding.request_id))throw Error('request_binding_conflict');
  const active=Object.values(l.records).filter(r=>r.owner);if(active.length>=limits.global||active.filter(r=>r.binding.session_id===binding.session_id).length>=limits.per_session)throw Error('assistant_busy');
  if(l.requests>=policy.max_requests)throw Error('request_budget_exhausted');if(l.committed+reserved>policy.budget_usd+1e-12)throw Error('currency_budget_exhausted');l.records[k]={binding,reserved_usd:reserved,phase:'reserved',generations:0,owner:{pid:process.pid,nonce:randomUUID()},terminal:null};l.requests++;l.committed+=reserved;return true;});}
 async generation(policy:LivePolicy,b:LiveBinding){return this.transaction(policy,l=>{const r=this.record(l,b);if(!r.owner||r.owner.pid!==process.pid||r.phase==='terminal')throw Error('dispatch_not_authorized');if(l.generations>=policy.max_generations||r.generations>=8)throw Error('generation_budget_exhausted');l.generations++;r.generations++;r.phase='dispatched';});}
 async settle(policy:LivePolicy,b:LiveBinding,terminal:Settlement){terminal=settlementSchema.parse(terminal);return this.transaction(policy,l=>{const r=this.record(l,b);if(r.terminal){if(JSON.stringify(r.terminal)!==JSON.stringify(terminal))throw Error('settlement_conflict');return;}if(terminal.cost_usd>r.reserved_usd+1e-12)throw Error('settlement_exceeds_reservation');if(!terminal.known&&terminal.cost_usd!==r.reserved_usd)throw Error('unknown_usage_requires_full_reservation');l.committed+=terminal.known?terminal.cost_usd-r.reserved_usd:0;r.terminal=terminal;r.phase='terminal';r.owner=null;},true);}
 async releaseAdmission(policy:LivePolicy,b:LiveBinding){return this.transaction(policy,l=>{const r=this.record(l,b);if(r.owner&&r.owner.pid!==process.pid)throw Error('admission_owner_mismatch');r.owner=null;},true);}
 private record(l:Ledger,b:LiveBinding){const r=l.records[key(b)];if(!r||JSON.stringify(r.binding)!==JSON.stringify(b))throw Error('request_binding_conflict');return r;}
}
