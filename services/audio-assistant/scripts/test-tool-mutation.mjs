import { mkdtemp,mkdir,readFile,writeFile,readdir,copyFile,rm } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname,join,resolve,relative,sep } from 'node:path';

// Mutate real product source in private disposable copies, keeping original tests and dependency resolution.
const service=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const outputArg=process.argv.indexOf('--output');
const output=outputArg<0?join(service,'.test-runtime-tool-mutation-report-'+randomUUID()):resolve(process.argv[outputArg+1]);
await mkdir(output,{recursive:false});
const productPath=join(service,'agent/lib/service.ts'),testPath=join(service,'test/service.test.ts');
const product=await readFile(productPath,'utf8'),tests=await readFile(testPath,'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
const mutations=[
 {name:'parameter_authorization_disabled',guard:"if(!parameter||parameter.unit!==p.unit||typeof parameter.value!==typeof p.value||(typeof p.value==='number'&&(p.value<parameter.min||p.value>parameter.max)))throw Error('unauthorized_parameter');"},
 {name:'evidence_identity_validation_disabled',guard:"if(p.evidence_refs.some(e=>!this.evidence.some(x=>JSON.stringify(x)===JSON.stringify(e))))throw Error('forged_evidence');"}
];
const report={schema_version:1,kind:'actual-product-tool-validation-mutations',source_file:'agent/lib/service.ts',source_sha256:hash(product),test_file:'test/service.test.ts',test_sha256:hash(tests),node:process.version,baseline:null,mutations:[],originals_unchanged:false,detected:0,total:mutations.length};
const counts=text=>Object.fromEntries(['tests','pass','fail','skipped'].map(key=>[key,Number(new RegExp('(?:# |ℹ )'+key+' (\\d+)').exec(text)?.[1]??0)]));
async function run(name,source,mutant){
 const work=await mkdtemp(join(service,'.test-runtime-tool-mutation-'));
 try{
  await mkdir(join(work,'agent/lib'),{recursive:true});await mkdir(join(work,'test'));
  for(const file of await readdir(join(service,'agent/lib')))if(file.endsWith('.ts'))await copyFile(join(service,'agent/lib',file),join(work,'agent/lib',file));
  await writeFile(join(work,'agent/lib/service.ts'),source);await writeFile(join(work,'test/service.test.ts'),tests);
  const args=['--experimental-strip-types','--test','--test-reporter=tap',...(mutant?['--test-name-pattern=^forged evidence, cross session, unauthorized patch and unevaluated candidate fail closed$']:[]),join(work,'test/service.test.ts')];
  const result=spawnSync(process.execPath,args,{cwd:service,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});
  await writeFile(join(output,name+'.stdout.txt'),result.stdout??'');await writeFile(join(output,name+'.stderr.txt'),result.stderr??'');await writeFile(join(output,name+'.service.ts'),source);
  return {name,assertion_failure:(result.stdout??'').includes("code: 'ERR_ASSERTION'")&&(result.stdout??'').includes("operator: 'rejects'"),exit_code:result.status,signal:result.signal,error:result.error?.message??null,source_sha256:hash(source),...counts(result.stdout??'')};
 }finally{
  const own=relative(service,work);if(own.startsWith('.test-runtime-tool-mutation-')&&!own.includes(sep))await rm(work,{recursive:true,force:true});else throw Error('temporary_copy_ownership_mismatch');
 }
}
report.baseline=await run('baseline',product,false);
for(const mutation of mutations){if(product.split(mutation.guard).length!==2)throw Error('mutation_target_missing_or_ambiguous:'+mutation.name);const source=product.replace(mutation.guard,'/* MUTANT: named product validation guard disabled */');const result=await run(mutation.name,source,true);const detected=result.exit_code!==0&&result.fail===1&&result.tests===1&&result.assertion_failure&&!result.error;report.mutations.push({...result,guard_sha256:hash(mutation.guard),detected});if(detected)report.detected++;}
report.originals_unchanged=hash(await readFile(productPath,'utf8'))===report.source_sha256&&hash(await readFile(testPath,'utf8'))===report.test_sha256;
await writeFile(join(output,'result.json'),JSON.stringify(report,null,2)+'\n');
const passed=report.baseline.exit_code===0&&report.baseline.fail===0&&report.baseline.pass>0&&report.detected===report.total&&report.originals_unchanged;
process.stdout.write(JSON.stringify({passed,baseline_tests:report.baseline.tests,detected:report.detected,total:report.total,output})+'\n');process.exitCode=passed?0:1;
