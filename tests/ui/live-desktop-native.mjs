import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {waitForEmbeddedTarget,waitForEmbeddedFrontend} from './embedded-discovery.mjs';
import {livePolicy} from '../../services/audio-assistant/test/live-fixture.ts';
import {canonicalJson,consentDigest,livePolicySchema} from '../../services/audio-assistant/agent/lib/live-policy.ts';
import {endpointMetadataDigest} from '../../services/audio-assistant/agent/lib/gateway-metadata.ts';
import {endpointFixture} from '../../services/audio-assistant/test/gateway-metadata-fixture.ts';
const args=new Map(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:[]).filter(a=>a.length));
for(const key of ['interface','sources','output','exe','cli'])assert.ok(args.get(key),`Explicit --${key} required`);
const scenario=args.get('case')??'level',run=resolve(args.get('output'));assert.ok(['level','level-fractional','compression','compression-wrong','dismiss','stale-control','stale-selection','stale-source','stale-session','tamper','cancel','noop','abstain','restart'].includes(scenario),'Unknown lifecycle probe');await mkdir(run,{recursive:true});
const publicInterface=JSON.parse(await readFile(resolve(args.get('interface')),'utf8'));
const slot=scenario.startsWith('compression')?'compression_apply_undo':scenario==='noop'||scenario==='abstain'?'noop_or_abstain':scenario==='cancel'?'cancel':scenario.startsWith('stale')||scenario==='tamper'?'stale_preview':scenario==='restart'?'disconnect':'level_apply_undo';
const row=publicInterface.lifecycle_requests.find(r=>r.request_id==='r_lifecycle_'+slot);assert.ok(row,'Public lifecycle template missing');
if(scenario==='level-fractional')row.input.parameters.outputDb=1.2;
const source=join(run,'source.wav');await copyFile(resolve(args.get('sources'),row.input.source),source);
const policy=livePolicySchema.parse({...livePolicy(),experiment_id:'desktop_'+randomUUID().replaceAll('-',''),budget_id:'desktop_'+randomUUID().replaceAll('-',''),admissions_sha256:publicInterface.admissions_sha256,task_sha256:publicInterface.experiment_manifest_sha256,metadata_sha256:endpointMetadataDigest(endpointFixture('test/model','test'),'test/model','test')});
const evaluation={schema_version:1,mode:'fault-injected',policy,canonical_policy_json:canonicalJson(policy),consent_sha256:consentDigest(policy),admissions:publicInterface.admissions,state_directory:join(run,'evaluation'),lifecycle_request_id:row.request_id,test_fetch_module:resolve('services/audio-assistant/test/fixtures/desktop-fetch.ts')};
const config=join(run,'private-evaluation.json');await writeFile(config,JSON.stringify(evaluation));
const port=Number(args.get('port')??9467),instance=randomUUID().replaceAll('-',''),audit=join(run,'fetch-audit.jsonl');
const app=spawn(resolve(args.get('exe')),['--web-ui-test','--web-debug-port',String(port),'--ui-test-instance',instance,'--source',source,'--private-evaluation-config',config],{windowsHide:true,stdio:'ignore',env:{...process.env,TONESCOPE_ASSISTANT_DIR:resolve('services/audio-assistant'),TONESCOPE_CLI_PATH:resolve(args.get('cli')),TONESCOPE_NODE_PATH:process.execPath,TONESCOPE_ASSISTANT_DATA_DIR:join(run,'native-private'),TONESCOPE_DESKTOP_FETCH_AUDIT:audit,TONESCOPE_DESKTOP_FAULT:scenario==='compression-wrong'?'compression-wrong':scenario==='cancel'?'late':scenario==='noop'||scenario==='abstain'?scenario:''}});
let socket;
try{
 const target=await waitForEmbeddedTarget(port);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((yes,no)=>{socket.onopen=yes;socket.onerror=no;});
 let sequence=0;const pending=new Map();socket.onmessage=e=>{const message=JSON.parse(e.data),p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}};
 const call=(method,params={})=>new Promise((yes,no)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);no(Error('Existing ten-second CDP deadline: '+method));},10000);pending.set(id,{resolve:v=>{clearTimeout(timer);yes(v);},reject:e=>{clearTimeout(timer);no(e);}});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
 const invoke=async(action,payload={})=>{const id=1000000+sequence;return evaluate(`new Promise(resolve=>{window.__JUCE__.backend.addEventListener('__juce__complete',v=>{if(v.promiseId===${id})resolve(v.result)});window.__JUCE__.backend.emitEvent('__juce__invoke',{name:'tonescopeCommand',params:[{version:1,action:${JSON.stringify(action)},...${JSON.stringify(payload)}}],resultId:${id}})})`);};
 const wait=async(predicate,label,timeout=20000)=>{const end=Date.now()+timeout;let state;while(Date.now()<end){state=await invoke('snapshot');if(predicate(state))return state;await pause(100);}throw Error(label+': '+state?.assistant?.message);};
 const settled=()=>wait(s=>s.ready&&!s.busy,'Current render');
 const click=async text=>{const point=await evaluate(`(()=>{const e=[...document.querySelectorAll('button,[role="tab"]')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Missing enabled control: '+${JSON.stringify(text)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};
 await waitForEmbeddedFrontend(evaluate);await settled();
 let state=await invoke('snapshot');
 for(const control of state.controls){const value=row.input.parameters[control.key];if(typeof value==='number'&&value!==control.value)await invoke('parameter',{key:control.key,value});}
 for(const [index,key] of ['compressor','equalizer','drive'].entries())await invoke('stage',{index,value:row.input.parameters[key]});
 await settled();
 if(row.input.passages){for(const kind of ['soft','hard']){const range=row.input.passages[kind];await invoke('selection',{from:range[0]/row.input.binding.frames,to:range[1]/row.input.binding.frames});await settled();await invoke('microscope.'+kind);}}
 await invoke('selection',{from:0,to:1});await settled();
 await invoke('parameter',{key:'inputDb',value:-.25});await settled();await invoke('parameter',{key:'inputDb',value:row.input.parameters.inputDb});await settled();
 const base=await invoke('snapshot'),controls=s=>Object.fromEntries(s.controls.map(c=>[c.key,Math.fround(c.value)]));
 await wait(s=>s.assistant?.status==='idle','Assistant startup');await click('Assistant');await pause(200);await evaluate("document.getElementById('assistant-prompt').focus()");await call('Input.insertText',{text:row.prompt});await click('Ask assistant');
 if(scenario==='cancel'){
  await wait(s=>s.assistant?.status==='running','Running request');for(let i=0;i<80;i++){try{if((await readFile(audit,'utf8')).includes('fixture_generation'))break;}catch{}await pause(50);}assert.ok((await readFile(audit,'utf8')).includes('fixture_generation'),'Cancel must occur during real SDK fetch');await invoke('assistant.cancel',{requestId:row.request_id});await pause(2000);const final=await invoke('snapshot');assert.deepEqual(controls(final),controls(base));assert.equal(final.assistant.proposal,undefined);assert.equal(final.canUndo,base.canUndo);
 }else if(scenario==='noop'||scenario==='abstain'){
  await wait(s=>s.assistant?.status==='idle'||s.assistant?.status==='error','Terminal request',45000);const final=await invoke('snapshot');assert.equal(final.assistant.status,'idle',final.assistant.message);assert.deepEqual(controls(final),controls(base));assert.equal(final.canUndo,base.canUndo);
 }else{
  const ready=await wait(s=>{if(s.assistant?.status==='error')throw Error(s.assistant.message);return s.assistant?.status==='ready'&&s.assistant.proposal?.previewReady;},'Verified proposal',45000);
  assert.deepEqual(controls(ready),controls(base));assert.equal(ready.canUndo,base.canUndo);
  await pause(200);await click('Preview suggestion');const preview=await wait(s=>s.assistant?.auditioning,'Verified audition');assert.deepEqual(controls(preview),controls(base));assert.equal(preview.canUndo,base.canUndo);
  await invoke('assistant.audition',{source:'baseline',matching:false});await wait(s=>s.assistant?.auditionSource==='baseline'&&s.assistant?.status==='ready','Baseline comparison');
  await invoke('assistant.audition',{source:'candidate',matching:true});await wait(s=>s.assistant?.auditionSource==='candidate'&&s.assistant?.status==='ready','Candidate comparison');
  if(scenario.startsWith('level')||scenario.startsWith('compression')){
   const traces=join(run,'evaluation','desktop-traces'),trace=(await readdir(traces)).find(p=>p.endsWith('.json'));
   execFileSync('python',[resolve('tests/ui/live-desktop-audio.py'),'--trace',join(traces,trace),'--family',scenario.startsWith('compression')?'compression':'level','--expected',scenario==='compression-wrong'?'objective-miss':'pass','--output',join(run,'independent-audio.json')],{windowsHide:true,stdio:'pipe'});
  }
  if(scenario==='compression-wrong'){
   await invoke('assistant.dismiss',{proposalId:row.request_id});const final=await invoke('snapshot');assert.deepEqual(controls(final),controls(base));assert.equal(final.canUndo,base.canUndo);
  }else if(scenario.startsWith('level')||scenario==='compression'){
   await pause(200);await click('Apply suggestion');const key=scenario.startsWith('level')?'outputDb':'thresholdDb',expected=scenario.startsWith('level')?Math.fround(controls(base)[key]-3):-20.5;const applied=await wait(s=>s.ready&&!s.busy&&s.assistant?.status==='idle'&&controls(s)[key]===expected,'Applied verified parameters');assert.equal(controls(applied)[key],expected);assert.deepEqual(Object.fromEntries(Object.entries(controls(applied)).filter(([k])=>k!==key)),Object.fromEntries(Object.entries(controls(base)).filter(([k])=>k!==key)));
   await invoke('undo');const restored=await settled();assert.deepEqual(controls(restored),controls(base));
  }else if(scenario==='dismiss'){
   await invoke('assistant.dismiss',{proposalId:row.request_id});const dismissed=await invoke('snapshot');assert.deepEqual(controls(dismissed),controls(base));assert.equal(dismissed.canUndo,base.canUndo);
  }else if(scenario==='stale-control'||scenario==='stale-selection'){
   if(scenario==='stale-control')await invoke('parameter',{key:'inputDb',value:-1});else await invoke('selection',{from:.1,to:.9});await settled();const changed=await invoke('snapshot');await invoke('assistant.apply',{proposalId:row.request_id,revision:ready.revision});const final=await invoke('snapshot');assert.deepEqual(controls(final),controls(changed));assert.equal(final.assistant.proposal,undefined);
  }else if(scenario==='stale-source'){
   const bytes=await readFile(source);bytes[bytes.length-1]^=1;await writeFile(source,bytes);await invoke('assistant.apply',{proposalId:row.request_id,revision:ready.revision});const final=await wait(s=>s.assistant?.status==='error','Changed source rejection');assert.deepEqual(controls(final),controls(base));assert.equal(final.canUndo,base.canUndo);
  }else if(scenario==='stale-session'){
   const beforeLedger=await readFile(join(run,'evaluation','budget-v2.json'),'utf8');await invoke('assistant.history.delete');await wait(s=>s.assistant?.status==='idle','New private assistant session');await invoke('assistant.apply',{proposalId:row.request_id,revision:ready.revision});const final=await invoke('snapshot');assert.deepEqual(controls(final),controls(base));assert.equal(final.assistant.proposal,undefined);assert.equal(final.canUndo,base.canUndo);assert.equal(await readFile(join(run,'evaluation','budget-v2.json'),'utf8'),beforeLedger);
  }else if(scenario==='restart'){
   const folders=(await readdir(join(run,'native-private'),{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name!=='history');assert.equal(folders.length,1);const nativeDirectory=join(run,'native-private',folders[0].name),envfile=join(nativeDirectory,'native.env');
   const values=Object.fromEntries((await readFile(envfile,'utf8')).trim().split(/\r?\n/).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1).replace(/^"|"$/g,'')];}));
   const ledger=await readFile(join(run,'evaluation','budget-v2.json'),'utf8'),calls=await readFile(audit,'utf8');
   const killed=execFileSync('pwsh',['-NoProfile','-Command',`$owned=Get-CimInstance Win32_Process -Filter "ParentProcessId = ${app.pid}" | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*native-env-file*' }; if(@($owned).Count -ne 1){throw 'One owned broker required'}; $owned | ForEach-Object { Stop-Process -Id $_.ProcessId; $_.ProcessId }`],{windowsHide:true,encoding:'utf8'});assert.match(killed,/\d/);
   const restarted=spawn(process.execPath,['--experimental-strip-types',resolve('services/audio-assistant/agent/lib/host.ts'),'--native-env-file',envfile,'--native-evaluation-config',config],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TONESCOPE_DESKTOP_FETCH_AUDIT:audit}});
   try{
    const handshake=await new Promise((yes,no)=>{let output='',diagnostics='';const timer=setTimeout(()=>no(Error('Existing eight-second host startup deadline exceeded')),8000);restarted.stderr.on('data',b=>{diagnostics+=b;});restarted.once('exit',()=>{clearTimeout(timer);no(Error('Restarted broker exited: '+diagnostics));});restarted.stdout.on('data',b=>{output+=b;if(output.includes('\n')){clearTimeout(timer);yes(JSON.parse(output.split('\n')[0]));}});});
    const url=`http://127.0.0.1:${handshake.address.port}`,headers={authorization:'Bearer '+values.TONESCOPE_BROKER_TOKEN,'content-type':'application/json'},snapshot=JSON.parse(await readFile(join(nativeDirectory,'manifest.json'),'utf8')).assets[0].snapshot;
    assert.equal((await fetch(url+`/v1/requests/${row.request_id}?session_id=${snapshot.session_id}`,{headers})).status,200);
    const duplicate=await fetch(url+'/v1/request',{method:'POST',headers,body:JSON.stringify({schema_version:1,request_id:row.request_id,session_id:snapshot.session_id,prompt:row.prompt})});assert.equal(duplicate.status,200);const denied=await duplicate.json();assert.equal(denied.status,'failed');assert.equal(denied.reason,'duplicate_request');assert.equal(await readFile(audit,'utf8'),calls);assert.equal(await readFile(join(run,'evaluation','budget-v2.json'),'utf8'),ledger);
    await invoke('assistant.dismiss',{proposalId:row.request_id});const final=await invoke('snapshot');assert.deepEqual(controls(final),controls(base));assert.equal(final.canUndo,base.canUndo);
   }finally{restarted.kill();}
  }else if(scenario==='tamper'){
   const privateFiles=await readdir(join(run,'native-private'));const requestFolder=privateFiles.find(n=>n!=='history');assert.ok(requestFolder);const previews=join(run,'native-private',requestFolder,'previews');
   async function corrupt(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const p=join(folder,entry.name);if(entry.isDirectory())await corrupt(p);else if(entry.name.endsWith('.wav')){const bytes=await readFile(p);bytes[bytes.length-1]^=1;await writeFile(p,bytes);}}}await corrupt(previews);await invoke('assistant.apply',{proposalId:row.request_id,revision:ready.revision});const denied=await wait(s=>s.assistant?.status==='error','Tampered preview rejection');assert.deepEqual(controls(denied),controls(base));assert.equal(denied.canUndo,base.canUndo);
  }
 }
 if(scenario==='stale-control'){await invoke('undo');await settled();}
 await invoke('undo');const historyProbe=await settled();assert.equal(controls(historyProbe).inputDb,-.25,'Assistant preview, terminal result and denial must add zero undo entries; acceptance adds exactly one');
 const files=(await readdir(join(run,'evaluation','desktop-traces'))).filter(f=>f.endsWith('.json'));assert.equal(files.length,1);const trace=JSON.parse(await readFile(join(run,'evaluation','desktop-traces',files[0]),'utf8'));
 assert.equal(trace.provenance,'fault-injected');assert.equal(trace.request_id,row.request_id);assert.equal(trace.consent_sha256,evaluation.consent_sha256);assert.ok(!JSON.stringify(trace).includes(row.prompt));assert.ok(!JSON.stringify(trace).includes(run));assert.deepEqual(trace.events.map(e=>e.sequence),trace.events.map((_,i)=>i+1));
 if(scenario.startsWith('level')||scenario==='compression'){for(const category of ['admission','reservation','generation_start','generation_end','measurements','render','compare','verified_preview','native_verified_preview','explicit_acceptance','native_apply','native_undo'])assert.ok(trace.events.some(e=>e.category===category),'Missing '+category);assert.equal(trace.events.find(e=>e.category==='explicit_acceptance').simulated,true);assert.deepEqual(trace.events.find(e=>e.category==='native_undo').parameters,trace.parameters_before);for(const key of ['baseline_audio','candidate_audio'])assert.equal(createHash('sha256').update(await readFile(join(run,'evaluation','desktop-traces',trace[key].file))).digest('hex'),trace[key].sha256);}
 const summary={schema_version:1,scenario,passed:true,provenance:'fault-injected',acceptance:scenario.startsWith('level')||scenario==='compression'?'simulated':'not-performed',request_id:row.request_id,events:trace.events.map(e=>e.category),human_acceptance:false,hardware:false,paid_calls:0};await writeFile(join(run,'result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{
 socket?.close();
 if(app.exitCode===null){execFileSync('pwsh',['-NoProfile','-Command',`$owned=Get-CimInstance Win32_Process -Filter "ParentProcessId = ${app.pid}"; $p=Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue; if($p){$null=$p.CloseMainWindow();if(-not $p.WaitForExit(5000)){Stop-Process -Id ${app.pid} -ErrorAction SilentlyContinue}}; $owned | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*native-env-file*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }`],{windowsHide:true,stdio:'ignore'});}
}
