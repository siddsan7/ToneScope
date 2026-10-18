import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Envelope } from './contracts.ts';

/** Persists structured results only. Prompt text, paths, handles, audio and credentials are excluded. */
export class StateStore {
 private directory:string;
 private ledgerQueue:Promise<unknown>=Promise.resolve();
 private historyQueue:Promise<unknown>=Promise.resolve();
 private limits:{max_records:number,max_bytes:number,max_age_ms:number};
 constructor(directory:string,limits:Partial<{max_records:number,max_bytes:number,max_age_ms:number}>={}){this.directory=directory;this.limits={max_records:32,max_bytes:8*1024*1024,max_age_ms:30*86400000,...limits};for(const value of Object.values(this.limits))if(!Number.isSafeInteger(value)||value<=0)throw Error('history_limits_invalid');}
 private history<T>(operation:()=>Promise<T>):Promise<T>{const task=this.historyQueue.then(operation);this.historyQueue=task.catch(()=>{});return task;}
 async prune(protectedKey?:string):Promise<{session_hash:string,preview_id:string}[]>{return this.history(()=>this.pruneUnlocked(protectedKey));}
 private async pruneUnlocked(protectedKey?:string){
  const removed:{session_hash:string,preview_id:string}[]=[];let names:string[];try{names=await readdir(this.directory);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return removed;throw e;}
  const files=await Promise.all(names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(async name=>({name,...await stat(join(this.directory,name))})));
  files.sort((a,b)=>a.mtimeMs-b.mtimeMs||a.name.localeCompare(b.name));let count=files.length,bytes=files.reduce((sum,f)=>sum+f.size,0);const now=Date.now();
  for(const file of files){if(file.name===protectedKey)continue;if(now-file.mtimeMs<=this.limits.max_age_ms&&count<=this.limits.max_records&&bytes<=this.limits.max_bytes)continue;
   const path=join(this.directory,file.name);const record=JSON.parse(await readFile(path,'utf8'));await unlink(path);--count;bytes-=file.size;
   if(typeof record.session_hash==='string'&&/^[a-f0-9]{64}$/.test(record.session_hash)&&typeof record.result?.preview?.preview_id==='string')removed.push({session_hash:record.session_hash,preview_id:record.result.preview.preview_id});
  }return removed;
 }

 private key(session:string,request:string){
  return createHash('sha256').update(session+'\0'+request).digest('hex')+'.json';
 }
 private async atomic(path:string,data:unknown){
  const temp=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,JSON.stringify(data),{mode:0o600,flag:'wx'});await rename(temp,path);}finally{try{await unlink(temp);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 }
 async save(session:string,result:Envelope){return this.history(async()=>{
  await mkdir(this.directory,{recursive:true});
  const redacted={...result,reason:result.reason?'redacted_'+result.status:null,
   proposal:result.proposal?{...result.proposal,hypotheses:['[redacted]'],expected_tradeoffs:['[redacted]'],limitations:['[redacted]']}:null};
  const record={session_hash:createHash('sha256').update(session).digest('hex'),result:redacted};if(Buffer.byteLength(JSON.stringify(record))>this.limits.max_bytes)throw Error('history_record_bytes_limit');
  const key=this.key(session,result.request_id);await this.atomic(join(this.directory,key),record);return this.pruneUnlocked(key);
 });}
 async load(session:string,request:string):Promise<Envelope|undefined>{
  try{return JSON.parse(await readFile(join(this.directory,this.key(session,request)),'utf8')).result;}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
 }
 async deleteSession(session:string){return this.history(async()=>{
  let files:string[];
  try{files=await readdir(this.directory);}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  const digest=createHash('sha256').update(session).digest('hex');
  for(const file of files.filter(x=>/^[a-f0-9]{64}\.json$/.test(x))){
   const path=join(this.directory,file);
   const data=JSON.parse(await readFile(path,'utf8'));
   if(data.session_hash===digest)await unlink(path);
  }
 });}
 /** Reserve before paid work. Crash/interrupted calls leave a conservative charge behind. */
 async updateBudget(limit:number,delta:number,settlement=false){
  if(!Number.isFinite(limit)||limit<=0||!Number.isFinite(delta))throw Error('budget_ledger_invalid');
  const update=async()=>{
   await mkdir(this.directory,{recursive:true});
   const lockPath=join(this.directory,'budget.lock');
   let lock;
   try{lock=await open(lockPath,'wx',0o600);}catch{throw Error('budget_ledger_locked');}
   try{
    const path=join(this.directory,'budget.json');let committed=0;
    try{
     committed=JSON.parse(await readFile(path,'utf8')).committed;
     if(!Number.isFinite(committed)||committed<0)throw Error('budget_ledger_invalid');
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const next=Math.max(0,committed+delta);
    if(!settlement&&next>limit+1e-12)throw Error('currency_budget_exhausted');
    await this.atomic(path,{schema_version:1,committed:next});
   }finally{await lock.close();await unlink(lockPath);}
  };
  const pending=this.ledgerQueue.then(update,update);
  this.ledgerQueue=pending.catch(()=>{});
  await pending;
 }
}
