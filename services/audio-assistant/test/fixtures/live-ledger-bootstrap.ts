import {readFile} from 'node:fs/promises';
import {LiveLedger} from '../../agent/lib/live-ledger.ts';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
await new LiveLedger(config.directory,async point=>{
 if(point===config.point){process.send?.({barrier:point});await new Promise(()=>{});}
}).reserve(config.policy,config.binding,0.016);
