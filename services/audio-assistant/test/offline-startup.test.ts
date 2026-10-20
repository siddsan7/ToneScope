import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('offline host starts without loading the paid provider SDK', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tonescope-offline-startup-'));
  const hook = join(folder, 'deny-provider.mjs');
  const manifest = join(folder, 'manifest.json');
  // A missing or slow live-only dependency must not gate offline readiness.
  await writeFile(hook, "import { registerHooks } from 'node:module'; registerHooks({ resolve(specifier, context, next) { if (specifier === 'ai') throw Error('offline_provider_module_loaded'); return next(specifier, context); } });");
  await writeFile(manifest, JSON.stringify({ executable: process.execPath, work_directory: join(folder, 'previews'), state_directory: join(folder, 'history'), assets: [] }));
  const child = spawn(process.execPath, ['--import', pathToFileURL(hook).href, '--experimental-strip-types', resolve('agent/lib/host.ts')], {
    env: { ...process.env, TONESCOPE_HOST_MANIFEST: manifest, TONESCOPE_BROKER_TOKEN: 'a'.repeat(64), TONESCOPE_ENABLE_LIVE: '0' },
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
