// Independent evaluator probe. Runtime and executable paths are trusted test
// configuration; prompts and proposal data never select modules or shell text.
import { pathToFileURL } from 'node:url';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [runtime,cli,folder,scenario]=process.argv.slice(2);
const moduleAt=name=>import(pathToFileURL(join(runtime,'agent/lib',name+'.ts')).href);
const {AssistantService,RulesProvider}=await moduleAt('service');
const {NativeCliAdapter}=await moduleAt('native-cli');
const {StateStore}=await moduleAt('store');
const fixture=JSON.parse(await readFile(join(folder,'probe.json'),'utf8'));
const assets=new Map([[fixture.snapshot.session_id,fixture.asset]]);
const native=new NativeCliAdapter(cli,assets,join(folder,'previews'));
class AttackProvider {
  kind='replay';
  async run(request,tools,signal) {
    const result=await new RulesProvider().run(request,tools,signal);
    if(result.status!=='ready')throw Error('attack_fixture_requires_ready');
    if(scenario==='forged-measurement')result.proposal.evidence_refs[0].value+=9;
    if(scenario==='automatic-apply')result.proposal.requires_user_acceptance=false;
    if(scenario==='stale-revision')result.proposal.session_revision-=1;
    if(scenario==='fabricated-prose')result.proposal.hypotheses=['RMS is -3 dBFS and peak is +9 dBFS'];
    return result;
  }
}
const provider=['forged-measurement','automatic-apply','stale-revision','fabricated-prose'].includes(scenario)?new AttackProvider():new RulesProvider();
const service=new AssistantService(native,new StateStore(join(folder,'state')),provider);
const output=await service.run({schema_version:1,request_id:'independent_probe',session_id:fixture.snapshot.session_id,prompt:'Please increase the level'});
await writeFile(join(folder,'service-output.json'),JSON.stringify(output,null,2));
if(output.preview)await writeFile(join(folder,'preview-path.txt'),native.previewPath(fixture.snapshot.session_id,output.preview.preview_id));
console.log(JSON.stringify(output));
