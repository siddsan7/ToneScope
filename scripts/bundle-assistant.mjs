// Local Node ESM broker bundle, never an Eve deployment or provider invocation.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(process.argv[3] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Build the broker with Node 24.x');
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
async function identity(folder) {
  const json = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  const owner = folder.includes(`${path.sep}apps${path.sep}frontend${path.sep}`) ? 'apps/frontend' : 'services/audio-assistant';
  const lock = JSON.parse(await readFile(path.join(root, owner, 'package-lock.json'), 'utf8'));
  const key = path.relative(path.join(root, owner), folder).split(path.sep).join('/');
  if (lock.packages?.[key]?.version !== json.version) throw new Error(`Installed package differs from lockfile: ${json.name}`);
  return { name: json.name, version: json.version, license: json.license ?? 'SEE LICENSE', folder, json };
}
const packages = new Map();
const moduleRoot = path.join(root, 'services/audio-assistant/node_modules');
for (const name of Object.keys(result.metafile.inputs)) {
  let folder = path.dirname(path.resolve(root, 'services/audio-assistant', name));
  while (folder.startsWith(moduleRoot + path.sep)) {
    let exists = false;
    try { await readFile(path.join(folder, 'package.json')); exists = true; } catch { /* ascend to owner */ }
    if (exists) {
      const pkg = await identity(folder);
      if (pkg.name && pkg.version) { packages.set(`${pkg.name}@${pkg.version}`, pkg); break; }
    }
    folder = path.dirname(folder);
  }
}
async function notices(pkg) {
  const texts = [];
  async function collect(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isFile() && /^(licen[sc]e|copying|notice|copyright)(\.|$|-)/i.test(entry.name)) {
        texts.push(`--- ${prefix}${entry.name} ---\n${await readFile(path.join(folder, entry.name), 'utf8')}`);
      } else if (entry.isDirectory() && /^(licenses?|notices?)$/i.test(entry.name)) { await collect(path.join(folder, entry.name), `${prefix}${entry.name}/`); }
    }
  }
  await collect(pkg.folder);
  if (!texts.length && pkg.name === '@ai-sdk/provider-utils' && pkg.license === 'Apache-2.0') {
    texts.push('Published npm archive omits license text; package.json declares Apache-2.0.\nFull license retained from https://www.apache.org/licenses/LICENSE-2.0.txt\n' + await readFile(new URL('../docs/licenses/Apache-2.0.txt', import.meta.url), 'utf8'));
  }
  if (!texts.length && pkg.name.startsWith('@radix-ui/') && pkg.license === 'MIT') {
    texts.push('Published npm archive omits license text; package.json declares MIT.\nRetained from https://github.com/radix-ui/primitives/blob/main/LICENSE\n' + await readFile(new URL('../docs/licenses/Radix-LICENSE.txt', import.meta.url), 'utf8'));
  }
  if (!texts.length) throw new Error(`Missing upstream license text: ${pkg.name}@${pkg.version}`);
  if (pkg.license === 'Apache-2.0') texts.push(await readFile(new URL('../docs/licenses/Apache-2.0.txt', import.meta.url), 'utf8'));
  return `${pkg.name}@${pkg.version} (${pkg.license})\n${texts.join('\n\n')}`;
}
async function emit(graph, inventory, noticeFile) {
  const sorted = [...graph.values()].sort((a,b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const text = [];
  for (const pkg of sorted) text.push(await notices(pkg));
  await writeFile(path.join(output, inventory), JSON.stringify(sorted.map(({name,version,license}) => ({name,version,license})), null, 2)+'\n');
  await writeFile(path.join(output, noticeFile), text.join('\n\n========================================\n\n')+'\n');
}
await emit(packages, 'dependencies.json', 'THIRD-PARTY-NOTICES.txt');
// Follow the installed production dependency graph, including transitive UI code.
const frontend = new Map();
async function visit(folder) {
  const pkg = await identity(folder);
  const key = `${pkg.name}@${pkg.version}`;
  if (frontend.has(key)) return;
  frontend.set(key, pkg);
  const resolver = createRequire(path.join(folder, 'package.json'));
  for (const name of Object.keys(pkg.json.dependencies ?? {})) {
    const search = resolver.resolve.paths(name) ?? [];
    let found;
    for (const candidate of search) {
      try { await readFile(path.join(candidate, name, 'package.json')); found = path.join(candidate,name); break; } catch { /* next module search path */ }
    }
    if (!found) throw new Error(`Missing installed dependency: ${name}`);
    await visit(found);
  }
}
const frontendFolder = path.join(root, 'apps/frontend');
const frontendJson = JSON.parse(await readFile(path.join(frontendFolder, 'package.json'),'utf8'));
for (const name of Object.keys(frontendJson.dependencies)) await visit(path.join(frontendFolder,'node_modules',name));
await emit(frontend, 'frontend-dependencies.json', 'FRONTEND-NOTICES.txt');
await writeFile(path.join(output, 'build-metafile.json'), JSON.stringify(result.metafile, null, 2)+'\n');
console.log(`Bundled local broker with ${packages.size} runtime and ${frontend.size} frontend package identities plus upstream notices in ${output}`);
