import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir,cp,rm,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {waitForEmbeddedTarget,waitForEmbeddedFrontend} from './embedded-discovery.mjs';

// End-to-end user-flow probe against the actual embedded WebView2 page and
// native bridge (--web-ui-test, hardware-free). Each run owns a fresh UI test
// identity, assistant data directory and recovery namespace.
// Usage: node tests/ui/user-flows-native.mjs --flow open|edit|decline|export|recovery --exe <ToneScope.exe> --output <dir> [--port n]
const args=new Map(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:[]).filter(a=>a.length));
for(const key of ['flow','exe','output'])assert.ok(args.get(key),`Explicit --${key} required`);
const flow=args.get('flow');assert.ok(['open','edit','decline','export','recovery'].includes(flow),'Unknown flow');
const exe=resolve(args.get('exe')),run=resolve(args.get('output')),port=Number(args.get('port')??9471);
await mkdir(run,{recursive:true});
const evidence={schema_version:1,flow,exe,port,startedUtc:new Date().toISOString(),hardware_opened:false,steps:[]};
const note=(step,data={})=>{evidence.steps.push({step,...data});};
const python=(code,...rest)=>execFileSync('python',['-c',code,...rest],{encoding:'utf8',windowsHide:true});

// Deterministic stereo fixture: 2 s soft then 2 s loud 220 Hz sine, float32 48 kHz.
const source=join(run,'source.wav');
python("import math,sys; from pathlib import Path; sys.path.insert(0,'evals'); from oracles import write_float_wav; n=192000; write_float_wav(Path(sys.argv[1]), [[(.02 if i<n//2 else .2)*math.sin(2*math.pi*220*i/48000) for i in range(n)]]*2)",source);
const measureWav=(path,from,to)=>JSON.parse(python("import json,math,sys; sys.path.insert(0,'evals'); from oracles import read_wav; rate,ch=read_wav(sys.argv[1]); a=int(sys.argv[2]); b=int(sys.argv[3]); seg=[c[a:b] for c in ch]; vals=[v for c in seg for v in c]; print(json.dumps({'channels':len(ch),'frames':len(ch[0]),'rms':math.sqrt(sum(v*v for v in vals)/len(vals)),'peak':max(abs(v) for v in vals)}))",path,String(from),String(to)));

const procs=[];
function launch(instance,withSource){
  const data=join(run,'assistant-data-'+procs.length);
  const argv=['--web-ui-test','--web-debug-port',String(port),'--ui-test-instance',instance];if(withSource)argv.push('--source',source);
  const child=spawn(exe,argv,{windowsHide:true,stdio:'ignore',env:{...process.env,TONESCOPE_ASSISTANT_DATA_DIR:data}});
  procs.push(child);note('launch',{pid:child.pid,instance,withSource});return child;
}
async function close(child,label){
  if(child.exitCode!==null)return 'already-exited';
  try{execFileSync('taskkill',['/PID',String(child.pid)],{stdio:'ignore',windowsHide:true});}catch{}
  for(let i=0;i<100&&child.exitCode===null;i++)await pause(100);
  if(child.exitCode!==null){note('close',{label,method:'graceful WM_CLOSE',exitCode:child.exitCode});return 'graceful';}
  child.kill();for(let i=0;i<50&&child.exitCode===null;i++)await pause(100);
  note('close',{label,method:'forced',exitCode:child.exitCode});return 'forced';
}
async function connect(){
  const target=await waitForEmbeddedTarget(port);
  const socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((yes,no)=>{socket.onopen=yes;socket.onerror=no;});
  let sequence=0;const pending=new Map();
  socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
  const call=(method,params={})=>new Promise((yes,no)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);no(Error('CDP timeout: '+method));},10000);pending.set(id,{resolve:v=>{clearTimeout(timer);yes(v);},reject:e=>{clearTimeout(timer);no(e);}});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const invoke=(action,payload={})=>{const id=3000000+sequence;return evaluate(`new Promise(resolve=>{window.__JUCE__.backend.addEventListener('__juce__complete',v=>{if(v.promiseId===${id})resolve(v.result)});window.__JUCE__.backend.emitEvent('__juce__invoke',{name:'tonescopeCommand',params:[{version:1,action:${JSON.stringify(action)},...${JSON.stringify(payload)}}],resultId:${id}})})`);};
  const wait=async(predicate,label,timeout=20000)=>{const end=Date.now()+timeout;let s;while(Date.now()<end){s=await invoke('snapshot');if(predicate(s))return s;await pause(100);}throw Error(`Native state timeout: ${label}; status=${s?.status}; assistant=${s?.assistant?.status}/${s?.assistant?.message}`);};
  const current=()=>wait(s=>s.ready&&!s.busy&&s.revision===s.renderedRevision&&s.selectionSummary?.available===true&&s.selectionSummary.revision===s.revision,'current render and selection summary');
  const point=async selector=>evaluate(`(()=>{const e=${selector};if(!e||e.disabled)throw Error('Missing or disabled control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const click=async selector=>{const p=await point(selector);await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
  const byText=(text,sel='button,[role="tab"]')=>`[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  await call('Runtime.enable');await waitForEmbeddedFrontend(evaluate);
  return {socket,call,evaluate,invoke,wait,current,click,byText};
}
const controls=s=>Object.fromEntries(s.controls.map(c=>[c.key,c.value]));
// Default is exact double equality; --compare float32 applies the Math.fround convention of live-desktop-native.mjs and logs exact differences.
const compareMode=args.get('compare')??'exact';assert.ok(['exact','float32'].includes(compareMode));const exactDiffs=[];
function sameControls(actual,expected,message,context){const a=controls(actual),e=controls(expected);const diffs=Object.keys(e).filter(k=>a[k]!==e[k]).map(k=>({key:k,actual:a[k],expected:e[k]}));if(diffs.length)exactDiffs.push({context,diffs});if(compareMode==='float32'){const f=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,Math.fround(v)]));assert.deepEqual(f(a),f(e),message);}else assert.deepEqual(a,e,message);}
const keyOf=(s,label)=>{const c=s.controls.find(c=>c.label===label);assert.ok(c,'Missing control '+label);return c.key;};
const dbfs=v=>`${(20*Math.log10(v)).toFixed(1)} dBFS`;
const summaryRows=ui=>ui.evaluate(`Object.fromEntries([...document.querySelectorAll('.selection-summary dl>div')].map(x=>[x.querySelector('dt').textContent,x.querySelector('dd').textContent]))`);
const screenshot=async(ui,name)=>{const shot=await ui.call('Page.captureScreenshot',{format:'png'});await writeFile(join(run,name),Buffer.from(shot.data,'base64'));};
function dialog(pid,title,path){
  return execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('tests/ui/file-dialog-uia.ps1'),'-ProcessId',String(pid),'-Title',title,'-Path',path],{encoding:'utf8',windowsHide:true}).trim();
}
let ui;
try{
 if(flow==='open'){
  const app=launch(randomUUID().replaceAll('-',''),false);ui=await connect();
  const empty=await ui.evaluate(`document.querySelector('.waveform svg').getAttribute('aria-label')`);assert.equal(empty,'No audio loaded');
  // Real Import flow: native command, then the actual Windows open dialog.
  const pending=ui.invoke('import');pending.catch(()=>{});
  note('import-dialog',{result:dialog(app.pid,'Import mono or stereo WAV',source)});await pending;
  const loaded=await ui.wait(s=>s.ready&&!s.busy&&s.duration>0,'imported source',30000);
  assert.equal(loaded.sampleRate,48000);assert.equal(loaded.channels,2);assert.equal(loaded.sourceFrames,192000);assert.ok(Math.abs(loaded.duration-4)<1e-9);
  assert.ok(loaded.dryPeaks.length>0&&loaded.dryPeaks.some(v=>v>0),'No measured waveform');
  for(let i=0;i<50;i++){if(await ui.evaluate(`document.querySelector('.waveform svg').getAttribute('aria-label')!=='No audio loaded'&&!!document.querySelector('.dry-wave')`))break;await pause(100);}
  const dom=await ui.evaluate(`({label:document.querySelector('.waveform svg').getAttribute('aria-label'),dry:document.querySelector('.dry-wave')?.getAttribute('d')?.length??0,wet:document.querySelector('.wet-wave')?.getAttribute('d')?.length??0,axis:[...document.querySelector('.scope-card .axis').querySelectorAll('span')].map(e=>e.textContent),total:document.querySelector('.time small')?.textContent,title:document.querySelector('.source-title h2')?.textContent,slider:!!document.querySelector('[aria-label="Playback position"]')})`);
  assert.equal(dom.label,'Dry and processed waveform with selected passage');assert.ok(dom.dry>100&&dom.wet>100,'Waveform paths not drawn');
  assert.deepEqual(dom.axis,['00:00.00','00:01.00','00:02.00','00:03.00','00:04.00'],'Timeline axis does not span the full source');assert.equal(dom.total,' / 00:04.00');assert.ok(dom.slider);
  note('loaded',{source:loaded.source,duration:loaded.duration,sourceFrames:loaded.sourceFrames,streamed:loaded.streamedSource,waveformBins:loaded.dryPeaks.length,dom});
  // Real pointer drag on the waveform from 25% to 75% of its width.
  const box=await ui.evaluate(`(()=>{const r=document.querySelector('.waveform').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  const y=box.y+box.h/2,x0=box.x+box.w*.25,x1=box.x+box.w*.75;
  await ui.call('Input.dispatchMouseEvent',{type:'mousePressed',x:x0,y,button:'left',clickCount:1,buttons:1});
  for(let i=1;i<=10;i++)await ui.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:x0+(x1-x0)*i/10,y,button:'left',buttons:1});
  await ui.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:x1,y,button:'left',clickCount:1});
  const selected=await ui.wait(s=>Math.abs(s.selection[0]-.25)<.01&&Math.abs(s.selection[1]-.75)<.01,'dragged selection');
  const state=await ui.current();const sum=state.selectionSummary;
  const start=Math.trunc(state.selection[0]*state.sourceFrames),end=Math.min(Math.trunc(state.selection[1]*state.sourceFrames),state.sourceFrames-state.latency);
  assert.deepEqual(sum.selectionSamples,[start,end]);
  let rows;for(let i=0;i<50;i++){rows=await summaryRows(ui);if(rows['Processed RMS']===dbfs(sum.wetRms))break;await pause(100);}
  assert.equal(rows['Dry reference RMS'],dbfs(sum.dryRms));assert.equal(rows['Processed RMS'],dbfs(sum.wetRms));assert.equal(rows['Processed sample peak'],dbfs(sum.wetPeak));
  const independent=measureWav(source,start,end);
  const dryRel=Math.abs(sum.dryRms-independent.rms)/independent.rms;assert.ok(dryRel<1e-5,'Native dry RMS differs from independent decode: '+dryRel);
  note('selection',{selection:selected.selection,samples:sum.selectionSamples,native:{dryRms:sum.dryRms,wetRms:sum.wetRms,wetPeak:sum.wetPeak,stages:state.stages},ui:rows,independentDry:independent,dryRelativeError:dryRel,metricsLine:state.metrics});
  await screenshot(ui,'open-selection.png');
 }else if(flow==='edit'){
  launch(randomUUID().replaceAll('-',''),true);ui=await connect();
  await ui.wait(s=>s.ready&&!s.busy&&s.duration>0,'source');
  await ui.invoke('selection',{from:.25,to:.75});await ui.invoke('quality',{value:1});
  for(const index of [0,1,2])await ui.invoke('stage',{index,value:true});
  const s0=await ui.current();assert.deepEqual(s0.stages,[true,true,true]);
  const edits=[['Threshold',-40],['Ratio',8],['Low shelf',6],['Drive',18]].map(([label,value])=>[keyOf(s0,label),value]);
  const states=[s0];
  for(const [key,value] of edits){
   const before=states.at(-1);assert.notEqual(controls(before)[key],value,'Edit must change '+key);
   const changed=await ui.invoke('parameter',{key,value});assert.equal(controls(changed)[key],value);assert.ok(changed.canUndo);
   const s=await ui.wait(x=>x.ready&&!x.busy&&x.revision===x.renderedRevision&&x.selectionSummary?.available&&x.selectionSummary.revision===x.revision&&x.revision>before.revision,'render after '+key);
   assert.notEqual(s.selectionSummary.wetRms,before.selectionSummary.wetRms,'Measured output unchanged after '+key);
   assert.equal(s.selectionSummary.dryRms,before.selectionSummary.dryRms,'Dry reference changed after '+key);
   const rows=await summaryRows(ui);
   note('edit',{key,value,wetRms:s.selectionSummary.wetRms,wetPeak:s.selectionSummary.wetPeak,uiProcessedRms:rows['Processed RMS'],revision:s.revision});states.push(s);
  }
  await screenshot(ui,'edit-after-changes.png');
  const undoButton=`document.querySelector('[aria-label="Undo parameter change"]')`,redoButton=`document.querySelector('[aria-label="Redo parameter change"]')`;
  const comparisons=[];
  for(let i=states.length-2;i>=0;i--){
   const rev=(await ui.invoke('snapshot')).revision;await ui.click(undoButton);
   const s=await ui.wait(x=>x.revision>rev&&x.ready&&!x.busy&&x.revision===x.renderedRevision&&x.selectionSummary?.available&&x.selectionSummary.revision===x.revision,'undo render');
   sameControls(s,states[i],'Undo did not restore exact parameters','undo to '+i);assert.deepEqual(s.stages,states[i].stages);
   comparisons.push({op:'undo',to:i,wetRms:s.selectionSummary.wetRms,expected:states[i].selectionSummary.wetRms,deltaDb:20*Math.log10(s.selectionSummary.wetRms/states[i].selectionSummary.wetRms)});
  }
  for(let i=1;i<states.length;i++){
   const rev=(await ui.invoke('snapshot')).revision;await ui.click(redoButton);
   const s=await ui.wait(x=>x.revision>rev&&x.ready&&!x.busy&&x.revision===x.renderedRevision&&x.selectionSummary?.available&&x.selectionSummary.revision===x.revision,'redo render');
   sameControls(s,states[i],'Redo did not restore exact parameters','redo to '+i);
   comparisons.push({op:'redo',to:i,wetRms:s.selectionSummary.wetRms,expected:states[i].selectionSummary.wetRms,deltaDb:20*Math.log10(s.selectionSummary.wetRms/states[i].selectionSummary.wetRms)});
  }
  const worst=Math.max(...comparisons.map(c=>Math.abs(c.deltaDb)));assert.ok(worst<=.01,'Undo/redo measured output differs by '+worst+' dB');
  const final=await ui.invoke('snapshot');assert.equal(final.canRedo,false);
  note('undo-redo',{compareMode,exactDiffs,comparisons,worstDeltaDb:worst,finalCanUndo:final.canUndo,finalCanRedo:final.canRedo});
 }else if(flow==='decline'){
  launch(randomUUID().replaceAll('-',''),true);ui=await connect();
  await ui.wait(s=>s.ready&&!s.busy&&s.duration>0,'source');await ui.invoke('selection',{from:.25,to:.75});await ui.current();
  await ui.wait(s=>s.assistant?.status==='idle','assistant startup',30000);
  await ui.click(ui.byText('Assistant'));await pause(300);
  const text=await ui.evaluate(`(()=>{const p=[...document.querySelectorAll('p')].find(e=>e.textContent.startsWith('Offline level assistant'));return {intro:p?.textContent??null,fffdInBody:document.body.innerText.includes('\\uFFFD'),fffdInHtml:document.documentElement.outerHTML.includes('\\uFFFD')}})()`);
  assert.ok(text.intro,'Offline assistant intro text not rendered');assert.ok(text.intro.includes('·'),'Intro text lacks the middle-dot separator');
  assert.ok(!text.intro.includes('�')&&!text.fffdInBody&&!text.fffdInHtml,'Rendered DOM contains U+FFFD');
  note('intro',{intro:text.intro,codepoints:[...text.intro.slice(0,30)].map(c=>c.codePointAt(0).toString(16)),fffdInBody:text.fffdInBody,fffdInHtml:text.fffdInHtml});
  const base=await ui.invoke('snapshot');
  await ui.evaluate(`document.getElementById('assistant-prompt').focus()`);await ui.call('Input.insertText',{text:'Make it brighter'});
  await ui.click(ui.byText('Ask assistant'));
  const running=await ui.wait(s=>s.assistant?.status!=='idle'||s.assistant?.requestId,'request accepted',10000).catch(()=>null);
  const final=await ui.wait(s=>s.assistant?.status==='idle'&&s.assistant?.requestId&&s.assistant?.message!==base.assistant?.message,'terminal abstain',45000);
  assert.equal(final.assistant.status,'idle',final.assistant.message);assert.equal(final.assistant.proposal,undefined);
  assert.deepEqual(controls(final),controls(base));assert.deepEqual(final.stages,base.stages);assert.equal(final.canUndo,base.canUndo);
  const uiMessage=await ui.evaluate(`document.body.innerText.includes(${JSON.stringify(final.assistant.message)})`);
  note('decline',{prompt:'Make it brighter',observedRunning:running?.assistant?.status??null,status:final.assistant.status,message:final.assistant.message,messageShownInUi:uiMessage,controlsUnchanged:true,canUndo:final.canUndo});
  await screenshot(ui,'decline.png');
 }else if(flow==='export'){
  const app=launch(randomUUID().replaceAll('-',''),true);ui=await connect();
  await ui.wait(s=>s.ready&&!s.busy&&s.duration>0,'source');
  await ui.invoke('quality',{value:1});await ui.invoke('stage',{index:2,value:true});await ui.invoke('stage',{index:0,value:true});
  const s0=await ui.current();await ui.invoke('parameter',{key:keyOf(s0,'Drive'),value:18});await ui.invoke('parameter',{key:keyOf(s0,'Threshold'),value:-30});
  await ui.invoke('selection',{from:.25,to:.75});const plain=await ui.current();assert.equal(plain.latency,0);
  const folder=join(run,'export');await mkdir(folder,{recursive:true});
  async function exportTo(name,label){
   const path=join(folder,name);const before=(await ui.invoke('snapshot')).status;
   const pending=ui.invoke('export.selection');pending.catch(()=>{});note('export-dialog',{label,result:dialog(app.pid,'Export processed WAV and evidence',path)});await pending;
   const done=await ui.wait(s=>s.status!==before&&/^Exported |^Export failed/.test(s.status),'export completion',30000);
   assert.match(done.status,/^Exported /,done.status);assert.ok(done.status.includes(name),'Export went to an unexpected file: '+done.status);await access(path);return {path,status:done.status};
  }
  const a=await exportTo('plain.wav','plain');
  // Turn on audition-only transforms: Dry monitor mode, low-band audition and RMS match.
  await ui.invoke('mode',{value:1});await ui.invoke('band',{value:1});await ui.invoke('match',{value:true});
  const auditioned=await ui.wait(s=>s.ready&&!s.busy&&s.revision===s.renderedRevision&&s.mode===1&&s.band===1&&s.matching===true,'audition transforms active');
  const b=await exportTo('auditioned.wav','auditioned');
  const files=(await readdir(folder)).sort();assert.deepEqual(files,['auditioned.evidence.json','auditioned.wav','plain.evidence.json','plain.wav'],'Unexpected export files: '+files);
  const [ea,eb]=[JSON.parse(await readFile(a.path.replace(/\.wav$/,'.evidence.json'),'utf8')),JSON.parse(await readFile(b.path.replace(/\.wav$/,'.evidence.json'),'utf8'))];
  const begin=Math.trunc(plain.selection[0]*plain.sourceFrames),end=Math.trunc(plain.selection[1]*plain.sourceFrames);
  for(const e of [ea,eb]){assert.equal(e.export_start_sample,begin);assert.equal(e.export_end_sample,end);assert.equal(e.frames,end-begin);assert.match(e.export_semantics,/audition band filters, monitor RMS match, boundary fades and safety guard are excluded/);}
  const ma=measureWav(a.path,0,end-begin),mb=measureWav(b.path,0,end-begin);
  assert.equal(ma.frames,end-begin);assert.equal(ma.channels,2);
  const bytesA=await readFile(a.path),bytesB=await readFile(b.path);const identical=Buffer.compare(bytesA,bytesB)===0;
  assert.ok(identical,'Raw export changed when audition-only transforms were active');
  const sum=plain.selectionSummary;const rmsRel=Math.abs(ma.rms-sum.wetRms)/sum.wetRms,peakRel=Math.abs(ma.peak-sum.wetPeak)/sum.wetPeak;
  assert.ok(rmsRel<1e-5&&peakRel<1e-5,`Export does not match displayed processed levels: rms ${rmsRel}, peak ${peakRel}`);
  note('export',{statusA:a.status,statusB:b.status,files,evidence:{start:ea.export_start_sample,end:ea.export_end_sample,frames:ea.frames,semantics:ea.export_semantics,latency:ea.latency_samples},measuredA:ma,measuredB:mb,rawBytesIdentical:identical,native:{wetRms:sum.wetRms,wetPeak:sum.wetPeak},rmsRelativeError:rmsRel,peakRelativeError:peakRel,auditionState:{mode:auditioned.mode,band:auditioned.band,matching:auditioned.matching}});
 }else if(flow==='recovery'){
  const instance=randomUUID().replaceAll('-','');const recoveryRoot=join(process.env.APPDATA,'ToneScope','ui-tests',instance);
  evidence.recoveryRoot=recoveryRoot;const first=launch(instance,true);ui=await connect();
  await ui.wait(s=>s.ready&&!s.busy&&s.duration>0,'source');
  for(const index of [0,2])await ui.invoke('stage',{index,value:true});
  const s0=await ui.invoke('snapshot');
  for(const [label,value] of [['Threshold',-33],['Drive',9],['Low shelf',4],['Output',-2]])await ui.invoke('parameter',{key:keyOf(s0,label),value});
  await ui.invoke('selection',{from:.3,to:.6});const saved=await ui.current();
  const file=join(recoveryRoot,'recovery','session.json');let text;
  for(let i=0;i<60;i++){try{text=await readFile(file,'utf8');const j=JSON.parse(text);if(JSON.stringify(j).includes('-33'))break;}catch{}await pause(100);}
  assert.ok(text,'Recovery snapshot not written to the isolated namespace');
  note('before-close',{controls:controls(saved),stages:saved.stages,selection:saved.selection,source:saved.source,recoveryFile:file});
  ui.socket.close();ui=null;const closeMethod=await close(first,'first');
  const second=launch(instance,false);ui=await connect();
  const offered=await ui.wait(s=>/recovery session is available/i.test(s.status),'recovery offer',15000);
  note('reopen',{status:offered.status,duration:offered.duration});
  // The status names Ctrl+Shift+R; try that real key path in the embedded page first.
  const mods=2|8;await ui.call('Input.dispatchKeyEvent',{type:'rawKeyDown',modifiers:mods,key:'R',code:'KeyR',windowsVirtualKeyCode:82});await ui.call('Input.dispatchKeyEvent',{type:'keyUp',modifiers:mods,key:'R',code:'KeyR',windowsVirtualKeyCode:82});
  await pause(3000);let viaShortcut=false;
  try{const s=await ui.invoke('snapshot');viaShortcut=s.duration>0;}catch{ui.socket.close();ui=await connect();const s=await ui.invoke('snapshot');viaShortcut=s.duration>0;}
  note('shortcut',{restoredByCtrlShiftR:viaShortcut});
  assert.ok(viaShortcut,'Ctrl+Shift+R named by the recovery status did not restore the session');
  const restored=await ui.wait(s=>s.ready&&!s.busy&&s.duration>0&&s.revision===s.renderedRevision,'recovered session',30000);
  sameControls(restored,saved,'Recovered parameters differ','recovery');assert.deepEqual(restored.stages,saved.stages,'Recovered stages differ');
  assert.equal(restored.source,saved.source);assert.equal(restored.sourceFrames,saved.sourceFrames);
  const selectionDelta=Math.max(...restored.selection.map((v,i)=>Math.abs(v-saved.selection[i])));
  note('restored',{via:viaShortcut?'Ctrl+Shift+R':'recover bridge command',controls:controls(restored),stages:restored.stages,selection:restored.selection,selectionDelta,closeMethod});
  await screenshot(ui,'recovered.png');
  ui.socket.close();ui=null;await close(second,'second');
  evidence.selectionRestored=selectionDelta<1e-6;
 }
 evidence.status='pass';
}catch(error){evidence.status='fail';evidence.error=error.stack??String(error);process.exitCode=1;}
finally{
 ui?.socket?.close();
 for(const child of procs)if(child.exitCode===null)await close(child,'cleanup');
 if(evidence.recoveryRoot){try{await access(evidence.recoveryRoot);await cp(evidence.recoveryRoot,join(run,'isolated-recovery-storage'),{recursive:true});await rm(evidence.recoveryRoot,{recursive:true,force:true});}catch{}}
 if(exactDiffs.length)evidence.exactDiffs=exactDiffs;
 evidence.processes=procs.map(p=>({pid:p.pid,exitCode:p.exitCode,signal:p.signalCode}));
 evidence.finishedUtc=new Date().toISOString();
 await writeFile(join(run,'result.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({flow,status:evidence.status,error:evidence.error?.split('\n')[0]}));
}
