// Run against ToneScope --web-ui-test --demo --web-debug-port 9337.
// Actual native measurements and commands; no physical audio device is opened.
import {writeFile,mkdir} from 'node:fs/promises';
const targets=await (await fetch(`http://127.0.0.1:${Number(process.env.TONESCOPE_WEB_DEBUG_PORT ?? 9337)}/json/list`)).json();
const page=targets.find(t=>t.type==='page');if(!page)throw Error('No embedded WebView page');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error(`CDP timeout: ${method}`));ws.close()},10000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id:n,method,params}))});
const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
await call('Runtime.enable');
const invoke=async(action,payload={})=>evaluate(`new Promise(resolve=>{const id=${10000+id};window.__JUCE__.backend.addEventListener('__juce__complete',v=>{if(v.promiseId===id)resolve(v.result)});window.__JUCE__.backend.emitEvent('__juce__invoke',{name:'tonescopeCommand',params:[{version:1,action:${JSON.stringify(action)},...${JSON.stringify(payload)}}],resultId:id})})`);
const first=await invoke('snapshot');if(!first.ready||!first.dryPeaks.length||!first.wetSpectrum.length)throw Error('Native engine not ready');
const before=first.controls.find(c=>c.key==='outputDb').value;
const changed=await invoke('parameter',{key:'outputDb',value:-3});if(changed.controls.find(c=>c.key==='outputDb').value!==-3||!changed.canUndo)throw Error('Native parameter change/undo unavailable');
const undone=await invoke('undo');if(undone.controls.find(c=>c.key==='outputDb').value!==before)throw Error('Native undo failed');
const rejected=await invoke('parameter',{key:'outputDb',value:999});if(rejected.controls.find(c=>c.key==='outputDb').value!==before)throw Error('Unsafe value accepted');
for(let i=0;i<100;i++){const state=await invoke('snapshot');if(state.ready&&!state.busy)break;await new Promise(r=>setTimeout(r,100));if(i===99)throw Error('Native render did not settle');}
await new Promise(r=>setTimeout(r,250));
await evaluate('document.querySelectorAll(\"main, aside\").forEach(e=>e.scrollTo(0,0))');
const dom=await evaluate(`({title:document.title,text:document.body.innerText,fonts:[...document.fonts].map(f=>({family:f.family,status:f.status})),hasJuce:!!window.__JUCE__,errors:document.querySelectorAll('[role=alert]').length})`);
if(!dom.hasJuce||!dom.text.includes('ToneScope'))throw Error('Bundled React missing');
await mkdir('artifacts/frontend-native',{recursive:true});
const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('artifacts/frontend-native/embedded.png',Buffer.from(screenshot.data,'base64'));
await writeFile('artifacts/frontend-native/probe.json',JSON.stringify({target:page.url,first:{...first,dryPeaks:first.dryPeaks.length,wetPeaks:first.wetPeaks.length,drySpectrum:first.drySpectrum.length,wetSpectrum:first.wetSpectrum.length,dryEnvelope:first.dryEnvelope.length,wetEnvelope:first.wetEnvelope.length},parameterAccepted:true,undoRestored:true,invalidRejected:true,dom},null,2));
await evaluate(`(()=>{const select=document.querySelector('[aria-label="Interface text size"]');select.value='200';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
let scaled;
for(let attempt=0;attempt<30;attempt++){
  await new Promise(r=>setTimeout(r,100));
  scaled=await evaluate(`({fontSize:getComputedStyle(document.documentElement).fontSize,width:innerWidth,contentWidth:document.documentElement.scrollWidth})`);
  if(scaled.fontSize==='26px'&&scaled.contentWidth<=scaled.width+1)break;
}
if(scaled.fontSize!=='26px'||scaled.contentWidth>scaled.width+1)throw Error('200% text scaling overflow: '+JSON.stringify(scaled));
await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'forced-colors',value:'active'}]});
const accessible=await evaluate(`({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,contrast:matchMedia('(forced-colors: active)').matches})`);
if(!accessible.reduced||!accessible.contrast)throw Error('Accessibility media emulation failed');
await writeFile('artifacts/frontend-native/accessibility-software.json',JSON.stringify({scaled,accessible,scope:'Software DOM/media checks only; no Narrator or human accessibility qualification.'},null,2));
console.log(JSON.stringify({target:page.url,ready:first.ready,nativeControls:first.controls.length,measuredWaveformBins:first.dryPeaks.length,parameterAccepted:true,undoRestored:true,invalidRejected:true,fonts:dom.fonts,scaled,accessible}));ws.close();
