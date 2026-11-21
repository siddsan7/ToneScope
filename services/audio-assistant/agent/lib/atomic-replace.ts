import {rename} from 'node:fs/promises';
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/** Retry only the same closed-file atomic rename on bounded sharing failures. Never unlink the destination. */
export async function replaceAtomically(source:string,destination:string,operations:{rename:(source:string,destination:string)=>Promise<void>;wait:(ms:number)=>Promise<void>}={rename,wait}){
 for(let attempt=0;;attempt++){
  try{await operations.rename(source,destination);return;}
  catch(error){if(attempt>=7||!['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw error;await operations.wait(Math.min(80,10*2**attempt));}
 }
}
