import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('inherited live environment cannot enable the provider SDK', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tonescope-offline-startup-'));
  const hook = join(folder, 'deny-provider.mjs');
  const manifest = join(folder, 'manifest.json');
  // A missing or slow live-only dependency must not gate offline readiness.
  await writeFile(hook, "import { registerHooks } from 'node:module'; registerHooks({ resolve(specifier, context, next) { if (specifier === 'ai') throw Error('offline_provider_module_loaded'); return next(specifier, context); } });");
  await writeFile(manifest, JSON.stringify({ executable: process.execPath, work_directory: join(folder, 'previews'), state_directory: join(folder, 'history'), assets: [] }));
  const child = spawn(process.execPath, ['--import', pathToFileURL(hook).href, '--experimental-strip-types', resolve('agent/lib/host.ts')], {
    env: { ...process.env, TONESCOPE_HOST_MANIFEST: manifest, TONESCOPE_BROKER_TOKEN: 'a'.repeat(64), TONESCOPE_ENABLE_LIVE: '1' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-4096); });
  try {
    const ready = await new Promise<string>((resolveReady, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error('offline readiness exceeded the existing eight-second startup budget')), 8000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('offline host exited before readiness: ' + diagnostics)); });
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (output.length > 4096) { clearTimeout(timer); reject(Error('excessive startup output')); }
        else if (output.includes('\n')) { clearTimeout(timer); resolveReady(output.split('\n')[0]); }
      });
    });
    const state = JSON.parse(ready);
    assert.equal(state.provider, 'rules');
    assert.equal(state.live_enabled, false);
    assert.equal(state.address.address, '127.0.0.1');
    assert.ok(state.address.port > 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    await rm(folder, { recursive: true, force: true });
  }
});

import {livePolicy,binding} from './live-fixture.ts';
import {StateStore} from '../agent/lib/store.ts';
import type {Envelope} from '../agent/lib/contracts.ts';
import {canonicalJson,consentDigest} from '../agent/lib/live-policy.ts';
import {admissionsDigest,promptDigest} from '../agent/lib/live-admission.ts';
test('native host rejects missing opt-in, mismatched consent/admissions and production test seams before SDK import',async()=>{
 const folder=await mkdtemp(join(process.cwd(),'.test-runtime-host-opt-in-'));
 try{
  const manifest=join(folder,'manifest.json'),envfile=join(folder,'native.env'),file=join(folder,'evaluation.json'),hook=join(folder,'deny.mjs');
  await writeFile(manifest,JSON.stringify({executable:process.execPath,work_directory:join(folder,'previews'),state_directory:join(folder,'history'),assets:[]}));
  await writeFile(envfile,`TONESCOPE_HOST_MANIFEST=${manifest}\nTONESCOPE_BROKER_TOKEN=${'a'.repeat(64)}\nTONESCOPE_ENABLE_LIVE=0\n`);
  await writeFile(hook,"import {registerHooks} from 'node:module';registerHooks({resolve(s,c,next){if(s==='ai')throw Error('SDK_FORBIDDEN');return next(s,c);}});");
  const admissions=[...Array.from({length:168},(_,i)=>({request_id:'scored_'+i,prompt_sha256:promptDigest('private'),role:'scored'})),...Array.from({length:6},(_,i)=>({request_id:'setup_'+i,prompt_sha256:promptDigest('setup'),role:'setup'})),...Array.from({length:6},(_,i)=>({request_id:'lifecycle_'+i,prompt_sha256:promptDigest('keep level'),role:'lifecycle'}))];
  const policy={...livePolicy(),admissions_sha256:admissionsDigest(admissions)};
  const base={schema_version:1,mode:'live',lifecycle_request_id:'lifecycle_0',policy,canonical_policy_json:canonicalJson(policy),consent_sha256:consentDigest(policy),admissions,state_directory:join(folder,'shared-budget')};
  async function reject(config:unknown,reason:RegExp,native=true){await writeFile(file,JSON.stringify(config));const result=spawnSync(process.execPath,['--import',pathToFileURL(hook).href,'--experimental-strip-types',resolve('agent/lib/host.ts'),...(native?['--native-env-file',envfile]:[]),'--native-evaluation-config',file],{env:{...process.env,AI_GATEWAY_API_KEY:'test-never-sent',TONESCOPE_HOST_MANIFEST:manifest,TONESCOPE_BROKER_TOKEN:'a'.repeat(64)},encoding:'utf8',windowsHide:true});assert.equal(result.status,1,result.stderr);assert.match(result.stderr,reason);assert.ok(!result.stderr.includes('SDK_FORBIDDEN'));}
  await reject(base,/native_explicit_opt_in_required/,false);
  await reject({...base,consent_sha256:'f'.repeat(64)},/native_consent_digest_mismatch/);
  await reject({...base,canonical_policy_json:base.canonical_policy_json+' '},/native_canonical_policy_mismatch/);
  await reject({...base,canonical_policy_json:undefined},/canonical_policy_json/);
  // JUCE decimal parsing can collapse this pair. The host still checks the
  // exact Node representation before either the SDK or a test seam is loaded.
  const original={...policy,input_usd_per_million:0.0008129756435363114};
  const rounded={...policy,input_usd_per_million:0.000812975643536311};
  await reject({...base,policy:original,canonical_policy_json:canonicalJson(rounded),consent_sha256:consentDigest(rounded)},/native_canonical_policy_mismatch/);
  await reject({...base,admissions:admissions.slice(1)},/incomplete_frozen_admissions/);
  await reject({...base,test_fetch_module:join(folder,'forbidden.mjs')},/native_test_seam_forbidden/);
  await reject({...base,mode:'fault-injected'},/native_test_seam_forbidden/);
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('explicit fault-injected host handshake binds consent without dispatching a generation',async()=>{
 const folder=await mkdtemp(join(process.cwd(),'.test-runtime-host-ready-'));let child:ReturnType<typeof spawn>|undefined;
 try{
  const manifest=join(folder,'manifest.json'),envfile=join(folder,'native.env'),file=join(folder,'evaluation.json'),seam=join(folder,'deny-fetch.mjs');
  await writeFile(manifest,JSON.stringify({executable:process.execPath,work_directory:join(folder,'previews'),state_directory:join(folder,'history'),assets:[{snapshot:{session_id:'session_1',session_revision:1,source_sha256:'a'.repeat(64),base_graph_sha256:'b'.repeat(64),source_handle:'source_1',selection_samples:[0,48000],sample_rate:48000,parameters:[]},source_path:join(folder,'unused.wav'),baseline_path:join(folder,'unused-baseline.wav'),parameters:{}}]}));
  await writeFile(envfile,`TONESCOPE_HOST_MANIFEST=${manifest}\nTONESCOPE_BROKER_TOKEN=${'a'.repeat(64)}\nTONESCOPE_ENABLE_LIVE=0\n`);
  await writeFile(seam,"export default async function(){throw Error('unexpected_provider_dispatch_at_startup');}");
  const admissions=[...Array.from({length:168},(_,i)=>({request_id:'scored_'+i,prompt_sha256:promptDigest('level'),role:'scored'})),...Array.from({length:6},(_,i)=>({request_id:'setup_'+i,prompt_sha256:promptDigest('setup'),role:'setup'})),...Array.from({length:6},(_,i)=>({request_id:'lifecycle_'+i,prompt_sha256:promptDigest('keep level'),role:'lifecycle'}))];
  const policy={...livePolicy(),admissions_sha256:admissionsDigest(admissions)};
  const value={schema_version:1,mode:'fault-injected',lifecycle_request_id:'lifecycle_0',policy,canonical_policy_json:canonicalJson(policy),consent_sha256:consentDigest(policy),admissions,state_directory:join(folder,'shared-budget'),test_fetch_module:seam};
  const requestStore=new StateStore(value.state_directory);
  const saved:Envelope={schema_version:1,request_id:'lifecycle_0',status:'noop',proposal:null,preview:null,reason:'private',usage:{input_tokens:0,output_tokens:0,cost_usd:0,tool_calls:0,candidate_frames:0,latency_ms:0},trace_id:'00000000-0000-4000-8000-000000000000',evidence_refs:[]};
  await requestStore.save('session_1',saved);
  await requestStore.reserveLive(policy,binding,.016);
  const ledgerBefore=await readFile(join(value.state_directory,'budget-v2.json'),'utf8');
  await writeFile(file,JSON.stringify(value));
  child=spawn(process.execPath,['--experimental-strip-types',resolve('agent/lib/host.ts'),'--native-env-file',envfile,'--native-evaluation-config',file],{env:{...process.env,AI_GATEWAY_API_KEY:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let diagnostics='';child.stderr!.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-4096);});
  const ready=await new Promise<string>((resolveReady,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('existing eight-second host startup deadline exceeded')),8000);child!.once('error',e=>{clearTimeout(timer);reject(e);});child!.once('exit',()=>{clearTimeout(timer);reject(Error('host exited before handshake: '+diagnostics));});child!.stdout!.on('data',chunk=>{text+=chunk.toString();if(text.length>4096){clearTimeout(timer);reject(Error('excessive handshake'));}else if(text.includes('\n')){clearTimeout(timer);resolveReady(text.split('\n')[0]);}});});
  const state=JSON.parse(ready);assert.equal(state.provider,'gateway');assert.equal(state.live_enabled,true);assert.equal(state.provenance,'fault-injected');assert.equal(state.consent_sha256,value.consent_sha256);assert.equal(state.experiment_id,policy.experiment_id);assert.equal(state.budget_id,policy.budget_id);assert.equal(state.address.address,'127.0.0.1');
  const url=`http://127.0.0.1:${state.address.port}`,headers={authorization:'Bearer '+'a'.repeat(64)};
  const loaded=await fetch(url+'/v1/requests/lifecycle_0?session_id=session_1',{headers});
  assert.equal(loaded.status,200,'live GET must use the same request store as AssistantService');
  assert.equal((await loaded.json() as Envelope).status,'noop');
  assert.equal((await fetch(url+'/v1/session?session_id=session_1',{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(url+'/v1/requests/lifecycle_0?session_id=session_1',{headers})).status,404);
  assert.equal(await readFile(join(value.state_directory,'budget-v2.json'),'utf8'),ledgerBefore,'history deletion must preserve durable funds and request tombstones');
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}await rm(folder,{recursive:true,force:true});}
});


