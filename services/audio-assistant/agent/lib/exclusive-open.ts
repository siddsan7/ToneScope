import {open,type FileHandle} from 'node:fs/promises';
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/** Windows sharing failures can outlive a closed lock handle. Never relax exclusive creation. */
export async function openExclusive(path:string,operations:{open:(path:string,flags:'wx',mode:number)=>Promise<FileHandle>;wait:(ms:number)=>Promise<void>}={open,wait}){
 for(let attempt=0;;attempt++){
  try{return await operations.open(path,'wx',0o600);}
  catch(error){if(attempt>=7||!['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw error;await operations.wait(Math.min(80,10*2**attempt));}
 }
}
