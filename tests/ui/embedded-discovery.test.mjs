import test from 'node:test';
import assert from 'node:assert/strict';
import {isEmbeddedTarget,waitForEmbeddedTarget,waitForEmbeddedFrontend} from './embedded-discovery.mjs';

const target={type:'page',url:'https://juce.backend/',webSocketDebuggerUrl:'ws://127.0.0.1:9337/devtools/page/app'};
const response=targets=>({ok:true,json:async()=>targets});
test('debug endpoint and blank pages precede the real app page',async()=>{
  const states=[[],[{type:'page',url:'about:blank'}],[{...target,type:'service_worker'}],[{...target,url:'https://juce.backend.example/'}],[{type:'page',url:target.url}],[target]];
  let calls=0;
  assert.deepEqual(await waitForEmbeddedTarget(9337,{pollMs:1,fetchImpl:async()=>response(states[calls++])}),target);
  assert.equal(calls,states.length);
  assert.equal(isEmbeddedTarget({type:'page'}),false);
});
test('transient connection and HTTP failures do not substitute a wrong target',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;if(calls===1)throw Error('connection refused');if(calls===2)return {ok:false,status:503};if(calls===3)return response({invalid:true});return response([target]);};
  assert.deepEqual(await waitForEmbeddedTarget(9338,{pollMs:1,fetchImpl}),target);
  assert.equal(calls,4);
});
test('a permanently blank target fails within the discovery deadline',async()=>{
  await assert.rejects(waitForEmbeddedTarget(9337,{timeoutMs:30,pollMs:1,fetchImpl:async()=>response([{type:'page',url:'about:blank'}])}),/No embedded ToneScope page before discovery deadline/);
});
test('stalled debug HTTP is aborted instead of waiting forever',async()=>{
  let aborted=false;
  const fetchImpl=async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));
  await assert.rejects(waitForEmbeddedTarget(9337,{timeoutMs:30,pollMs:1,fetchImpl}),/discovery deadline/);
  assert.equal(aborted,true);
});
test('frontend readiness tolerates navigation and waits for mounted native UI',async()=>{
  let calls=0;
  await waitForEmbeddedFrontend(async expression=>{assert.match(expression,/__JUCE__/);calls++;if(calls===1)throw Error('navigation');return calls>=3;},{pollMs:1});
  assert.equal(calls,3);
  await assert.rejects(waitForEmbeddedFrontend(async()=>false,{timeoutMs:30,pollMs:1}),/did not become ready/);
});
