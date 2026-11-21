import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {openExclusive} from '../agent/lib/exclusive-open.ts';

test('exclusive lock sharing retry preserves path, wx, permissions and ownership boundary',async()=>{
 const directory=await mkdtemp(join(process.cwd(),'.test-runtime-exclusive-')),path=join(directory,'lock');let attempts=0,waits=0;
 try{
  const handle=await openExclusive(path,{async open(target,flags,mode){assert.equal(target,path);assert.equal(flags,'wx');assert.equal(mode,0o600);if(++attempts<3)throw Object.assign(Error('sharing'),{code:'EPERM'});return open(target,flags,mode);},async wait(){waits++;}});
  await handle.writeFile('owned');await handle.close();assert.equal(await readFile(path,'utf8'),'owned');assert.equal(attempts,3);assert.equal(waits,2);
  await assert.rejects(openExclusive(path),{code:'EEXIST'});assert.equal(await readFile(path,'utf8'),'owned');
 }finally{await rm(directory,{recursive:true,force:true});}
});

for(const code of ['EEXIST','EIO','EPERM','EACCES','EBUSY'])test('exclusive open bounds and preserves '+code,async()=>{
 let attempts=0,waits=0;const error=Object.assign(Error('blocked'),{code});
 await assert.rejects(openExclusive('unchanged.lock',{async open(){attempts++;throw error;},async wait(ms){assert.ok(ms>=10&&ms<=80);waits++;}}),e=>e===error);
 assert.equal(attempts,['EEXIST','EIO'].includes(code)?1:8);assert.equal(waits,attempts-1);
});
