import {setTimeout as pause} from 'node:timers/promises';

export function isEmbeddedTarget(target){
  return target?.type==='page'&&typeof target.url==='string'
    &&target.url.startsWith('https://juce.backend/')
    &&typeof target.webSocketDebuggerUrl==='string'&&target.webSocketDebuggerUrl.startsWith('ws://');
}

// The debug endpoint can exist while WebView2 still exposes about:blank.
// Wait for the application page, rather than treating any page as ready.
export async function waitForEmbeddedTarget(port,{timeoutMs=15000,pollMs=100,fetchImpl=fetch}={}){
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid loopback test port');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000||!Number.isFinite(pollMs)||pollMs<1||pollMs>1000)throw Error('Invalid discovery bounds');
  const deadline=Date.now()+timeoutMs;
  let last='No debug response';
  while(Date.now()<deadline){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.min(1000,Math.max(1,deadline-Date.now())));
    try{
      const response=await fetchImpl(`http://127.0.0.1:${port}/json/list`,{signal:controller.signal});
      if(!response.ok)throw Error(`Debug HTTP ${response.status}`);
      const targets=await response.json();
      if(!Array.isArray(targets))throw Error('Invalid debug target list');
      const target=targets.find(isEmbeddedTarget);
      if(target)return target;
      last=JSON.stringify(targets.map(t=>({type:t?.type,url:t?.url})));
    }catch(error){last=String(error);}finally{clearTimeout(timer);}
    const remaining=deadline-Date.now();
    if(remaining>0)await pause(Math.min(pollMs,remaining));
  }
  throw Error(`No embedded ToneScope page before discovery deadline: ${last}`);
}

export async function waitForEmbeddedFrontend(evaluate,{timeoutMs=15000,pollMs=100}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000||!Number.isFinite(pollMs)||pollMs<1||pollMs>1000)throw Error('Invalid frontend readiness bounds');
  const deadline=Date.now()+timeoutMs;
  let last='Frontend not mounted';
  while(Date.now()<deadline){
    try{if(await evaluate("Boolean(window.__JUCE__?.backend && document.querySelector('main'))"))return;}catch(error){last=String(error);}
    const remaining=deadline-Date.now();
    if(remaining>0)await pause(Math.min(pollMs,remaining));
  }
  throw Error(`Embedded native bridge/frontend did not become ready: ${last}`);
}
