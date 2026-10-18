import {mkdir,writeFile} from 'node:fs/promises';

// Hardware-free test of the actual bundled page and native command boundary.
const port=Number(process.env.TONESCOPE_WEB_DEBUG_PORT ?? 9337);
const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target=targets.find(value=>value.type==='page'&&value.url.startsWith('https://juce.backend/'));
if(!target)throw Error('No embedded ToneScope page');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let sequence=0;
const pending=new Map();
socket.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(!message.id)return;
  const request=pending.get(message.id);
  if(!request)return;
  pending.delete(message.id);
  message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result);
};
function call(method,params={}){
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));socket.close();},10000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression){
  const response=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function invoke(action,payload={}){
  const id=1000000+sequence;
  return evaluate(`new Promise(resolve=>{window.__JUCE__.backend.addEventListener('__juce__complete',value=>{if(value.promiseId===${id})resolve(value.result)});window.__JUCE__.backend.emitEvent('__juce__invoke',{name:'tonescopeCommand',params:[{version:1,action:${JSON.stringify(action)},...${JSON.stringify(payload)}}],resultId:${id}})})`);
}
async function waitFor(predicate,label,timeout=20000){
  const end=Date.now()+timeout;
  let state;
  while(Date.now()<end){
    state=await invoke('snapshot');
    if(predicate(state))return state;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(`Native state timeout: ${label}; ${state?.status}; ${state?.assistant?.message}`);
}
const settled=()=>waitFor(state=>state.ready&&!state.busy,'current render');
async function clickText(text,role='button'){
  const point=await evaluate(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(role==='tab'?'[role="tab"]':'button')})].find(value=>value.textContent.trim()===${JSON.stringify(text)});if(!element||element.disabled)throw Error('Missing or disabled control: '+${JSON.stringify(text)});element.scrollIntoView({block:'center'});const box=element.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
await call('Runtime.enable');
const first=await settled();
if(!first.dryPeaks.length||!first.wetSpectrum.length)throw Error('Measured traces are absent');
const output=state=>state.controls.find(control=>control.key==='outputDb').value;
const before=output(first);
const changed=await invoke('parameter',{key:'outputDb',value:-3});
if(output(changed)!==-3||!changed.canUndo)throw Error('Native parameter transaction unavailable');
if(output(await invoke('undo'))!==before)throw Error('Native undo failed');
if(output(await invoke('parameter',{key:'outputDb',value:999}))!==before)throw Error('Unsafe control accepted');
await settled();
const evidence={target:target.url,source:first.source,duration:first.duration,sourceFrames:first.sourceFrames,inspectionOffset:first.inspectionOffset,inspectionEnd:first.inspectionEnd,streamedSource:first.streamedSource,nativeControls:first.controls.length,measuredWaveformBins:first.dryPeaks.length,parameterAccepted:true,undoRestored:true,invalidRejected:true};

if(process.env.TONESCOPE_TEST_ASSISTANT==='1'){
  await invoke('parameter',{key:'thresholdDb',value:-36});
  await invoke('stage',{index:0,value:true});
  await settled();
  await invoke('selection',{from:.05,to:.4});await settled();
  await invoke('microscope.soft');
  await invoke('selection',{from:.8,to:.95});await settled();
  await invoke('microscope.hard');
  const measured=await waitFor(state=>state.microscope?.current&&state.microscope.measurements?.valid,'manual passage measurements');
  if(!(measured.microscope.measurements.dryContrastDb>10)||!measured.gainReductionHistory.some(value=>value>0))throw Error('Actual soft/hard dynamics or GR missing');
  await invoke('selection',{from:.05,to:.95});await settled();
  const requestBase=await invoke('snapshot');
  await new Promise(resolve=>setTimeout(resolve,200));
  await clickText('Assistant','tab');
  await evaluate(`document.getElementById('assistant-prompt').focus()`);
  await call('Input.insertText',{text:'Make this passage louder'});
  await clickText('Ask assistant');
  const ready=await waitFor(state=>state.assistant?.status==='ready'&&state.assistant.proposal?.previewReady,'verified assistant proposal',45000);
  await new Promise(resolve=>setTimeout(resolve,200));
  await clickText('Preview suggestion');
  await waitFor(state=>state.assistant?.auditioning,'candidate audition');
  const blocked=await invoke('mode',{value:1});
  if(blocked.mode!==2||!blocked.assistant?.auditioning)throw Error('General mode escaped preview guard');
  await invoke('assistant.audition',{source:'candidate',matching:true});
  const matched=await waitFor(state=>state.assistant?.auditioning&&state.assistant.matched,'candidate RMS match');
  if(Math.abs(matched.assistant.matchGainDb+6)>.02)throw Error('Actual +6dB candidate did not receive -6dB comparison correction');
  await new Promise(resolve=>setTimeout(resolve,200));
  await clickText('Current settings');
  const baseline=await waitFor(state=>state.assistant?.auditionSource==='baseline'&&state.assistant.status==='ready','baseline A/B');
  if(!baseline.assistant.matched)throw Error('A/B lost the frozen-match preference');
  await new Promise(resolve=>setTimeout(resolve,200));
  await clickText('Suggestion');
  await waitFor(state=>state.assistant?.auditionSource==='candidate'&&state.assistant.status==='ready','candidate A/B');
  await new Promise(resolve=>setTimeout(resolve,200));
  await clickText('Apply suggestion');
  const applied=await waitFor(state=>state.ready&&!state.busy&&output(state)>output(requestBase),'explicit native acceptance');
  if(Math.abs(output(applied)-output(requestBase)-6)>.001)throw Error('Accepted patch differed from verified proposal');
  await invoke('undo');
  const restored=await settled();
  if(output(restored)!==output(requestBase))throw Error('One undo did not restore original graph');
  const remaining=JSON.stringify(restored.controls.filter(control=>control.key!=='outputDb').map(control=>control.value));
  const original=JSON.stringify(requestBase.controls.filter(control=>control.key!=='outputDb').map(control=>control.value));
  if(remaining!==original)throw Error('Acceptance altered unrelated controls');
  await invoke('assistant.history.delete');
  await waitFor(state=>state.assistant?.status==='idle','history deletion');
  evidence.assistant={nativePreview:true,explicitApply:true,oneUndo:true,baselineCandidateAB:true,frozenMatchDb:matched.assistant.matchGainDb,unrelatedControlsPreserved:true,manualContrastDb:measured.microscope.measurements.dryContrastDb};
}
await new Promise(resolve=>setTimeout(resolve,200));
await evaluate(`document.querySelectorAll('main,aside').forEach(element=>element.scrollTo(0,0))`);
const fonts=await evaluate(`[...document.fonts].map(value=>({family:value.family,status:value.status}))`);
if(!fonts.every(font=>font.status==='loaded'))throw Error('Bundled font failed to load');
await mkdir('artifacts/frontend-native',{recursive:true});
const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
await writeFile('artifacts/frontend-native/embedded.png',Buffer.from(screenshot.data,'base64'));
await evaluate(`(()=>{const select=document.querySelector('[aria-label="Interface text size"]');select.value='200';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
let scaled;
for(let attempt=0;attempt<30;attempt++){
  await new Promise(resolve=>setTimeout(resolve,100));
  scaled=await evaluate(`({fontSize:getComputedStyle(document.documentElement).fontSize,width:innerWidth,contentWidth:document.documentElement.scrollWidth})`);
  if(scaled.fontSize==='26px'&&scaled.contentWidth<=scaled.width+1)break;
}
if(scaled.fontSize!=='26px'||scaled.contentWidth>scaled.width+1)throw Error('200% text scaling overflow: '+JSON.stringify(scaled));
await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'forced-colors',value:'active'}]});
const accessible=await evaluate(`({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,contrast:matchMedia('(forced-colors: active)').matches})`);
if(!accessible.reduced||!accessible.contrast)throw Error('Accessibility media emulation failed');
await writeFile('artifacts/frontend-native/probe.json',JSON.stringify({...evidence,fonts,scaled,accessible},null,2));
await writeFile('artifacts/frontend-native/accessibility-software.json',JSON.stringify({scaled,accessible,scope:'Software DOM/media checks; no human or Narrator qualification.'},null,2));
console.log(JSON.stringify({...evidence,fonts,scaled,accessible}));
socket.close();
