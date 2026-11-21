import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {waitForEmbeddedTarget,waitForEmbeddedFrontend} from './embedded-discovery.mjs';
import {assistantProposalReady} from './assistant-state.mjs';

// Regression probe for duplicate dispatch after a broker restart, using a normal
// offline launch: actual desktop, its authenticated loopback broker and the real
// native CLI. A `ready` result is stored, the owned broker is killed and restarted
// over the same private state, and the same request id is resent. The duplicate must
// be refused and the stored result must stay byte-identical (file bytes and GET body).
// Usage: node tests/ui/broker-duplicate-native.mjs --exe <ToneScope.exe> --output <dir> [--port n]
const args=new Map(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:[]).filter(a=>a.length));
for(const key of ['exe','output'])assert.ok(args.get(key),`Explicit --${key} required`);
const exe=resolve(args.get('exe')),run=resolve(args.get('output')),port=Number(args.get('port')??9473),data=join(run,'assistant-data');
await mkdir(data,{recursive:true});
const evidence={schema_version:1,scope:'Offline rules broker, real native CLI, hardware-free --web-ui-test; no provider network',startedUtc:new Date().toISOString()};
const source=join(run,'source.wav');
execFileSync('python',['-c',"import math,sys; from pathlib import Path; sys.path.insert(0,'evals'); from oracles import write_float_wav; write_float_wav(Path(sys.argv[1]), [[(.02 if n<96000 else .2)*math.sin(2*math.pi*220*n/48000) for n in range(192000)]]*2)",source],{windowsHide:true});
const instance=randomUUID().replaceAll('-','');
const app=spawn(exe,['--web-ui-test','--web-debug-port',String(port),'--ui-test-instance',instance,'--source',source],{windowsHide:true,stdio:'ignore',env:{...process.env,TONESCOPE_ASSISTANT_DATA_DIR:data}});
evidence.appPid=app.pid;
let socket,restarted;
const hashTree=async root=>{const out={};const walk=async dir=>{for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else out[relative(root,p).replaceAll('\\','/')]=createHash('sha256').update(await readFile(p)).digest('hex');}};await walk(root);return out;};
const ownedBrokers=()=>execFileSync('powershell',['-NoProfile','-Command',`@(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${app.pid}" | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*native-env-file*' } | ForEach-Object { $_.ProcessId }) -join ','`],{encoding:'utf8',windowsHide:true}).trim().split(',').filter(Boolean).map(Number);
try{
 const target=await waitForEmbeddedTarget(port);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((yes,no)=>{socket.onopen=yes;socket.onerror=no;});
 let sequence=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 const call=(method,params={})=>new Promise((yes,no)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);no(Error('CDP timeout: '+method));},10000);pending.set(id,{resolve:v=>{clearTimeout(timer);yes(v);},reject:e=>{clearTimeout(timer);no(e);}});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async x=>{const r=await call('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const invoke=(action,payload={})=>{const id=4000000+sequence;return evaluate(`new Promise(resolve=>{window.__JUCE__.backend.addEventListener('__juce__complete',v=>{if(v.promiseId===${id})resolve(v.result)});window.__JUCE__.backend.emitEvent('__juce__invoke',{name:'tonescopeCommand',params:[{version:1,action:${JSON.stringify(action)},...${JSON.stringify(payload)}}],resultId:${id}})})`);};
 const wait=async(pred,label,timeout=20000)=>{const end=Date.now()+timeout;let s;while(Date.now()<end){s=await invoke('snapshot');if(pred(s))return s;await pause(100);}throw Error(`Native state timeout: ${label}; ${s?.assistant?.status}/${s?.assistant?.message}`);};
 const click=async text=>{const p=await evaluate(`(()=>{const e=[...document.querySelectorAll('button,[role="tab"]')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Missing enabled control: '+${JSON.stringify(text)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
 await call('Runtime.enable');await waitForEmbeddedFrontend(evaluate);
 await wait(s=>s.ready&&!s.busy&&s.duration>0,'source');await invoke('selection',{from:.05,to:.95});await wait(s=>s.ready&&!s.busy,'render');
 await wait(s=>s.assistant?.status==='idle','assistant startup',30000);
 await click('Assistant');await pause(200);await evaluate("document.getElementById('assistant-prompt').focus()");await call('Input.insertText',{text:'Make this passage louder'});await click('Ask assistant');
 const ready=await wait(assistantProposalReady,'verified offline proposal',45000);
 const requestId=ready.assistant.requestId;assert.ok(requestId,'Desktop did not expose its request id');
 const folders=(await readdir(data,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name!=='history');assert.equal(folders.length,1);
 const privateDir=join(data,folders[0].name),envFile=join(privateDir,'native.env');
 const env=Object.fromEntries((await readFile(envFile,'utf8')).trim().split(/\r?\n/).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1).replace(/^"|"$/g,'')];}));
 const manifest=JSON.parse(await readFile(join(privateDir,'manifest.json'),'utf8'));const sessionId=manifest.assets[0].snapshot.session_id;const stateDir=manifest.state_directory;
 const firstPort=JSON.parse(await readFile(join(privateDir,'ready.json'),'utf8')).address.port;
 const headers={authorization:'Bearer '+env.TONESCOPE_BROKER_TOKEN,'content-type':'application/json'};
 const get=async base=>{const r=await fetch(`${base}/v1/requests/${requestId}?session_id=${sessionId}`,{headers});return {status:r.status,body:await r.text()};};
 const before=await get(`http://127.0.0.1:${firstPort}`);assert.equal(before.status,200);assert.equal(JSON.parse(before.body).status,'ready','Stored result is not ready');
 const filesBefore=await hashTree(stateDir);
 const brokers=ownedBrokers();assert.equal(brokers.length,1,'Exactly one owned broker required');
 execFileSync('powershell',['-NoProfile','-Command',`Stop-Process -Id ${brokers[0]}`],{windowsHide:true});
 for(let i=0;i<50&&ownedBrokers().length;i++)await pause(100);assert.equal(ownedBrokers().length,0,'Owned broker did not stop');
 const host=resolve('services/audio-assistant/agent/lib/host.ts');
 restarted=spawn(process.execPath,['--env-file='+envFile,'--experimental-strip-types',host,'--native-env-file',envFile],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const handshake=await new Promise((yes,no)=>{let out='',diag='';const t=setTimeout(()=>no(Error('Existing eight-second host startup deadline exceeded')),8000);restarted.stderr.on('data',b=>{diag+=b;});restarted.once('exit',()=>{clearTimeout(t);no(Error('Restarted broker exited: '+diag));});restarted.stdout.on('data',b=>{out+=b;if(out.includes('\n')){clearTimeout(t);yes(JSON.parse(out.split('\n')[0]));}});});
 const base=`http://127.0.0.1:${handshake.address.port}`;
 const afterRestart=await get(base);
 const duplicate=await fetch(base+'/v1/request',{method:'POST',headers,body:JSON.stringify({schema_version:1,request_id:requestId,session_id:sessionId,prompt:'Make this passage louder'})});
 const denied=await duplicate.json();
 const afterDuplicate=await get(base);const filesAfter=await hashTree(stateDir);
 Object.assign(evidence,{requestId,sessionHashPrefix:createHash('sha256').update(sessionId).digest('hex').slice(0,12),firstPort,restartedPort:handshake.address.port,provider:handshake.provider,live_enabled:handshake.live_enabled,
  duplicateHttp:duplicate.status,duplicateStatus:denied.status,duplicateReason:denied.reason,
  storedBodySha256:{before:createHash('sha256').update(before.body).digest('hex'),afterRestart:createHash('sha256').update(afterRestart.body).digest('hex'),afterDuplicate:createHash('sha256').update(afterDuplicate.body).digest('hex')},
  stateFilesBefore:filesBefore,stateFilesAfter:filesAfter});
 assert.equal(duplicate.status,200);assert.equal(denied.status,'failed');assert.equal(denied.reason,'duplicate_request');
 assert.equal(afterRestart.status,200);assert.equal(afterRestart.body,before.body,'Restarted broker returned a different stored result');
 assert.equal(afterDuplicate.status,200);assert.equal(afterDuplicate.body,before.body,'Duplicate changed the stored result body');
 assert.deepEqual(filesAfter,filesBefore,'Duplicate changed persisted state files');
 await invoke('assistant.dismiss',{proposalId:ready.assistant.proposal.id});
 evidence.status='pass';
}catch(error){evidence.status='fail';evidence.error=error.stack??String(error);process.exitCode=1;}
finally{
 socket?.close();restarted?.kill();
 if(app.exitCode===null){try{execFileSync('taskkill',['/PID',String(app.pid)],{stdio:'ignore',windowsHide:true});}catch{}for(let i=0;i<100&&app.exitCode===null;i++)await pause(100);if(app.exitCode===null){app.kill();evidence.appClose='forced';}else evidence.appClose='graceful';}
 try{evidence.remainingOwnedBrokers=ownedBrokers();}catch{evidence.remainingOwnedBrokers='app exited';}
 evidence.finishedUtc=new Date().toISOString();
 await writeFile(join(run,'result.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({status:evidence.status,duplicateReason:evidence.duplicateReason,storedBodySha256:evidence.storedBodySha256,error:evidence.error?.split('\n')[0]}));
}
