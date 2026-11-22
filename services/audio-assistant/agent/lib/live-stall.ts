/** Collector-only stall watchdog. Records where a request process is stuck; it never changes a request's outcome. */
import {ledgerProgress} from './live-ledger.ts';

/** Content-free facts about a request process that outlived its own wall-time limit. */
export type StallDiagnostic={schema_version:1;request_id:string;elapsed_ms:number;ledger_step:string;output_written:boolean;active_resources:Record<string,number>};

/** Counts active Node resource types (for example FSReqPromise, Timeout, ProcessWrap). Unexpected names collapse to "other". */
export function stallDiagnostic(request_id:string,elapsed_ms:number,ledger_step:string,output_written:boolean,resources:readonly string[]):StallDiagnostic{
 const active_resources:Record<string,number>={};
 for(const resource of resources){
  const name=/^[A-Za-z]{1,40}$/.test(resource)?resource:'other';
  if(name in active_resources||Object.keys(active_resources).length<32)active_resources[name]=Math.min(10000,(active_resources[name]??0)+1);
 }
 return {schema_version:1,request_id,elapsed_ms:Math.max(0,Math.min(600000,Math.round(elapsed_ms))),ledger_step:/^[a-z_]{1,40}$/.test(ledger_step)?ledger_step:'other',output_written,active_resources};
}

/**
 * Fires once if the process is still alive after `deadlineMs`. The timer is unreferenced, so it never keeps a
 * finished process alive; it can only fire when something else (a stuck handle) does.
 */
export function armStallWatchdog(request_id:string,deadlineMs:number,emit:(diagnostic:StallDiagnostic)=>void){
 const start=performance.now();const state={output_written:false};
 const timer=setTimeout(()=>emit(stallDiagnostic(request_id,performance.now()-start,ledgerProgress.step,state.output_written,process.getActiveResourcesInfo())),deadlineMs);
 timer.unref();
 return state;
}
