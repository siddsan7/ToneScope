// Use the frontend's locked build tool. This bundles the local broker, not an
// Eve deployment or provider invocation. Node 24 remains a runtime prerequisite.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/frontend/package.json'));
const { build } = require('esbuild');
const output = path.resolve(process.argv[2] ?? path.join(root, 'artifacts/assistant-bundle'));
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: path.join(root, 'services/audio-assistant'),
  entryPoints: ['agent/lib/host.ts'], outfile: path.join(output, 'host.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  legalComments: 'linked', metafile: true,
  banner: { js: "import { createRequire as __tsCreateRequire } from 'node:module'; const require = __tsCreateRequire(import.meta.url);" },
});
const packages = new Map();
for (const name of Object.keys(result.metafile.inputs)) {
  let folder = path.dirname(path.resolve(root, 'services/audio-assistant', name));
  while (folder.startsWith(path.join(root, 'services/audio-assistant/node_modules'))) {
    try {
      const json = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
      if (json.name && json.version) { packages.set(json.name, { name: json.name, version: json.version, license: json.license ?? 'SEE LICENSE' }); break; }
    } catch { /* continue to owning package */ }
    folder = path.dirname(folder);
  }
}
await writeFile(path.join(output, 'dependencies.json'), JSON.stringify([...packages.values()].sort((a,b) => a.name.localeCompare(b.name)), null, 2)+'\n');
await writeFile(path.join(output, 'build-metafile.json'), JSON.stringify(result.metafile, null, 2)+'\n');
console.log(`Bundled local broker and ${packages.size} package identities in ${output}`);
