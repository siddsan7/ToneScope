import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantProposalReady } from './assistant-state.mjs';

test('only a verified ready proposal satisfies the existing assistant assertion', () => {
  for (const state of [undefined, {}, {assistant:{status:'running'}}, {assistant:{status:'idle'}}, {assistant:{status:'ready',proposal:{previewReady:false}}}]) assert.ok(!assistantProposalReady(state));
  assert.equal(assistantProposalReady({assistant:{status:'ready',proposal:{previewReady:true}}}), true);
});
test('terminal native errors fail immediately with their bounded diagnostic', () => {
  assert.throws(() => assistantProposalReady({assistant:{status:'error',message:'Local assistant process exited before readiness.'}}), /process exited before readiness/);
  assert.throws(() => assistantProposalReady({assistant:{status:'error',message:'x'.repeat(2000)}}), error => error instanceof Error && error.message.length < 600);
});
