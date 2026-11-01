import {it,expect,afterAll} from 'vitest';
import {setImmediate as nativeSetImmediate} from 'node:timers';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parse as acorn} from 'acorn';
import {collectNativeFutureImpactSources} from '../existing-ops-workspace-source.js';
import {frozenFutureGit,readFrozenFutureBytes,frozenTypedOutputFutureGit,materializeFrozenCollector} from './helpers/future-active-git.js';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import { buildExistingOpsSources } from './helpers/existing-ops-proof-builder.js';
import { fixtureGit, readFixedExistingOpsGitFixture } from './helpers/fixed-existing-ops-git-fixture.js';
const { revision, paths, read } = readFixedExistingOpsGitFixture();
const workflow='.github/workflows/implementation-impact.yml';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const frozenProfile=frozenTypedOutputFutureGit(root);
it('已知历史Git fixture 保持 F2/F3 消费者来源协议',async()=>{
 const proof=await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths,readSource:async path=>read(path)});
 expect(proof.consumers.every(c=>c.status==='verified'),JSON.stringify(proof.consumers.map(c=>c.gaps))).toBe(true);
});

it('当前HEAD的未审部署与CI字节不得继承历史Git fixture的消费者资格', async () => {
 const candidate = readFixedExistingOpsGitFixture(fixtureGit('rev-parse', 'HEAD').trim());
 expect(candidate.revision).not.toBe(revision);
 const proof = await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',
  revision:candidate.revision,paths:candidate.paths,readSource:async path=>{
   const text=candidate.read(path);
   if(path==='scripts/brain-deploy.sh')return text+'\necho unreviewed-deployment';
   if(path==='.github/workflows/ci.yml')return 'name: unreviewed CI\njobs: {}\n';
   return text;
  }});
 expect(proof.revision).toBe(candidate.revision);
 for (const consumer of proof.consumers) {
  expect(consumer.status, JSON.stringify(consumer.gaps)).toBe('unknown');
  expect(consumer.gaps.length).toBeGreaterThan(0);
  expect(consumer.bindings).toEqual([]);
  expect(consumer.input_relations).toEqual([]);
 }
 expect(proof.consumers[0].gaps).toContainEqual({code:'isolated_staging_source_unproven'});
 expect(proof.consumers[1].gaps.length).toBeGreaterThan(0);
 for (const workflow of proof.workflows) {
  expect(workflow.executable).toBe(false);
  expect(workflow.coverage.status).toBe('unknown');
  expect(workflow.coverage.verified_reference_ids).toEqual([]);
 }
});
const entry='scripts/ci/implementation-multi-pr-gate.mjs',multi='scripts/ci/implementation-multi-scope.mjs';
const approvedRun="set -euo pipefail\nif [[ \"$MODE\" == pr && -n \"$ADMISSION_SCOPES\" ]]; then\n  jq -e 'type == \"object\" and keys == [\"schema_version\", \"scopes\"] and .schema_version == 1 and (.scopes | type == \"array\" and length > 0 and all(.[]; type == \"string\" and test(\"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$\")) and length == (unique | length))' <<< \"$ADMISSION_SCOPES\" >/dev/null\n  jq --arg root \"$RUNNER_TEMP/implementation-input\" '.scopes | map({scope:.,snapshotBase:($root+\"/base/base-\"+.+\".json\"),snapshotHead:($root+\"/head/head-\"+.+\".json\")})' <<< \"$ADMISSION_SCOPES\" > \"$RUNNER_TEMP/implementation-input/scopes.json\"\n  node tooling/scripts/ci/implementation-multi-pr-gate.mjs --repo-root \"$GITHUB_WORKSPACE/source\" \\\n    --base \"$BASE\" --head \"$HEAD\" --mode \"$MODE\" --scopes-file \"$RUNNER_TEMP/implementation-input/scopes.json\" --output-dir \"$RUNNER_TEMP/implementation-output\"\nelse\n  node tooling/scripts/ci/implementation-pr-gate.mjs --repo-root \"$GITHUB_WORKSPACE/source\" --scope \"$MAP_SCOPE\" \\\n    --base \"$BASE\" --head \"$HEAD\" --mode \"$MODE\" \\\n    --snapshot-base \"$RUNNER_TEMP/implementation-input/base/base.json\" \\\n    --snapshot-head \"$RUNNER_TEMP/implementation-input/head/head.json\" --output-dir \"$RUNNER_TEMP/implementation-output\"\nfi\n";
const doc=yaml.load(read(workflow));
doc.on.workflow_call.inputs.admission_scopes={required:false,type:'string',default:''};
doc.jobs.gate.if="always() && (github.event_name == 'pull_request' || needs.snapshot-main.result == 'success')";
doc.jobs.gate.env.MODE="${{ inputs.mode || (github.event_name == 'pull_request' && 'pr' || 'main') }}";
doc.jobs.gate.env.ADMISSION_SCOPES="${{ inputs.admission_scopes || vars.IMPLEMENTATION_ADMISSION_SCOPES || '' }}";
doc.jobs.gate.steps=[{run:approvedRun}];
const model=new Map([[workflow,yaml.dump(doc)],[entry,`import {collectImplementationPrEvidence} from './implementation-pr-gate.mjs';
import {resolveScopedImplementationReports,runScopedImplementationGate} from './implementation-multi-scope.mjs';
export async function runImplementationMultiPrGate({scopes,repoRoot}){
try{
 const reports=[];
 for(const input of scopes){const {report}=await collectImplementationPrEvidence(input);reports.push(report);}
 const resolution=resolveScopedImplementationReports({reports});
 const receipt=await runScopedImplementationGate({repoRoot,evidence:resolution.evidence});
 receipt.resolution_sha256=resolution.resolution_sha256;
 return receipt;
}catch(error){throw error;}}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1]))runImplementationMultiPrGate({}).then(()=>{}).catch(()=>{});
`],[multi,`import {runRegisteredAssertions} from './implementation-gate.mjs';
export async function runScopedImplementationGate({repoRoot,evidence,timeoutMs}){
 verifyScopedImplementationGitSource(repoRoot,evidence);
 for(const report of evidence.scope_reports){
 const assertions=await runRegisteredAssertions({repoRoot,source:evidence.source,required_assertions:report.required_assertions,timeoutMs});
 }
 return {};
}`]]);
model.set('scripts/ci/implementation-pr-gate.mjs','export function collectImplementationPrEvidence(options){return implementationPrEvidence(options,false); }');
const fixtureRead=path=>model.get(path)??read(path);
const build=async overrides=>(await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths:[...new Set([...paths,...model.keys()])],readSource:async path=>overrides?.[path]??fixtureRead(path)})).consumers[1];
it('F3只以固定PR条件runner和实际AST调用链认领多scope脚本，完整工厂仍不可执行',async()=>{
 expect(createHash('sha256').update(approvedRun).digest('hex')).toBe('8e54cd03b82a18c8c94eaf0a438744193e093d680aa133f416e33ba4ca3ae21d');
 const f3=await build();expect(f3.status,JSON.stringify(f3.gaps)).toBe('verified');
 for(const path of [workflow,entry,multi,'scripts/ci/implementation-pr-gate.mjs','scripts/ci/implementation-gate.mjs'])expect(f3.bindings.some(b=>b.path===path),path).toBe(true);
 expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:entry,kind:'conditional_pr_admission_runner'}));
 expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:entry,input_path:multi,kind:'reachable_named_import_call'}));
});
it.each(['comment','dead_branch','boolean_step','wrong_env','wrong_schema'])('PR runner %s变化不得用旧字符串伪认领',async kind=>{
 const doc=yaml.load(fixtureRead(workflow)),job=doc.jobs.gate;
 const step=job.steps.find(s=>typeof s.run==='string'&&s.run.includes('implementation-multi-pr-gate.mjs'));
 if(kind==='comment')step.run=step.run.split('\n').map(l=>'# '+l).join('\n');
 if(kind==='dead_branch')step.run=step.run.replace('[[ "$MODE" == pr && -n "$ADMISSION_SCOPES" ]]','false');
 if(kind==='boolean_step')step.if=false;
 if(kind==='wrong_env')job.env.MODE='main';
 if(kind==='wrong_schema')doc.on.workflow_call.inputs.admission_scopes.required=true;
 const result=await build({[workflow]:yaml.dump(doc)});expect(result.status).toBe('unknown');expect(result.bindings).toEqual([]);
});
it.each(['comment','dead_function','dead_if','removed_import'])('多scope实际调用链 %s缺失则F3 UNKNOWN',async kind=>{
 let text=fixtureRead(entry);
 if(kind==='comment')text='/*'+text+'*/';
 if(kind==='dead_function')text=text.replace('const receipt=await runScopedImplementationGate','function unused(){const receipt=runScopedImplementationGate').replace('receipt.resolution_sha256=resolution.resolution_sha256;','} const receipt={};');
 if(kind==='dead_if')text=text.replace('const receipt=await runScopedImplementationGate({repoRoot,evidence:resolution.evidence});','if(false){await runScopedImplementationGate({repoRoot,evidence:resolution.evidence});} const receipt={};');
 if(kind==='removed_import')text=text.replace("from './implementation-multi-scope.mjs'","from './unrelated.mjs'");
 const result=await build({[entry]:text});expect(result.status).toBe('unknown');expect(result.bindings).toEqual([]);
});

it.each(['early_return','break_loop','dead_assertion'])('联合真实回归 %s不能留下可认领来源',async kind=>{
 let text=fixtureRead(multi);
 if(kind==='early_return')text=text.replace('verifyScopedImplementationGitSource(repoRoot,evidence);','return; verifyScopedImplementationGitSource(repoRoot,evidence);');
 if(kind==='break_loop')text=text.replace('for(const report of evidence.scope_reports){','for(const report of evidence.scope_reports){break;');
 if(kind==='dead_assertion')text=text.replace('const assertions=await runRegisteredAssertions({repoRoot,source:evidence.source,required_assertions:report.required_assertions,timeoutMs});','if(false){await runRegisteredAssertions({});} const assertions=[];');
 const result=await build({[multi]:text});expect(result.status).toBe('unknown');expect(result.bindings).toEqual([]);
});

const selfPr="${{ inputs.admission_scopes || vars.IMPLEMENTATION_ADMISSION_SCOPES || (github.event_name == 'pull_request' && github.repository == 'perfectuser21/cecelia' && '{\"schema_version\":1,\"scopes\":[\"cecelia-kr\",\"cecelia-factory\"]}' || '') }}";
it('唯一version1自仓PR双scope表达式与旧式均能证明，MODE/run字节不变',async()=>{
 const doc=yaml.load(fixtureRead(workflow));doc.jobs.gate.env.ADMISSION_SCOPES=selfPr;
 const result=await build({[workflow]:yaml.dump(doc)});expect(result.status,JSON.stringify(result.gaps)).toBe('verified');
});
it.each(['repo','scope','version','dead'])('自仓PR表达式 %s变体拒绝，不泛化env白名单',async kind=>{
 const doc=yaml.load(fixtureRead(workflow));
 doc.jobs.gate.env.ADMISSION_SCOPES=kind==='repo'?selfPr.replace('perfectuser21/cecelia','attacker/cecelia'):kind==='scope'?selfPr.replace('cecelia-factory','arbitrary'):kind==='version'?selfPr.replace('schema_version\":1','schema_version\":2'):selfPr.replace("github.event_name == 'pull_request'",'false');
 const result=await build({[workflow]:yaml.dump(doc)});expect(result.status).toBe('unknown');expect(result.bindings).toEqual([]);
});

const legacyRun='node tooling/scripts/ci/implementation-pr-gate.mjs --repo-root "$GITHUB_WORKSPACE/source" --scope "$MAP_SCOPE" '+String.fromCharCode(92)+'\n  --base "$BASE" --head "$HEAD" --mode "$MODE" '+String.fromCharCode(92)+'\n  --snapshot-base "$RUNNER_TEMP/implementation-input/base/base.json" '+String.fromCharCode(92)+'\n  --snapshot-head "$RUNNER_TEMP/implementation-input/head/head.json" --output-dir "$RUNNER_TEMP/implementation-output"\n';
const legacyPr=`import {runImplementationGate} from './implementation-gate.mjs';
export async function runImplementationPrGate(options){try{
 const receipt=await runImplementationGate(options);
 return receipt;
}catch(error){throw error;}}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1])){
runImplementationPrGate(parseArgs(process.argv.slice(2))).then(()=>{}).catch(()=>{});
}`;
it.each(['actual','comment','dead_branch','early_return'])('旧main单scope真实runner %s保留或拒绝，无须D候选生产存在',async kind=>{
 const doc=yaml.load(read(workflow));doc.jobs.gate.steps=[{run:legacyRun}];delete doc.jobs.gate.env.IMPLEMENTATION_MAIN_SCOPES;
 if(kind==='comment')doc.jobs.gate.steps[0].run='# '+legacyRun.replaceAll('\n','\n# ');
 if(kind==='dead_branch')doc.jobs.gate.steps[0].if='false';
 const sources=new Map([[workflow,yaml.dump(doc)],['scripts/ci/implementation-pr-gate.mjs',kind==='early_return'?legacyPr.replace('const receipt=','return; const receipt='):legacyPr]]);
 const f3=(await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths:paths.filter(p=>![entry,multi].includes(p)),readSource:async path=>sources.get(path)??read(path)})).consumers[1];
 expect(f3.status,JSON.stringify(f3.gaps)).toBe(kind==='actual'?'verified':'unknown');
 if(kind==='actual')expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:'scripts/ci/implementation-pr-gate.mjs',kind:'direct_admission_runner'}));
 else expect(f3.bindings).toEqual([]);
});

it('同名局部函数冒充真实import不能提供可认领来源',async()=>{
 const text=fixtureRead(entry).replace('try{','try{ const runScopedImplementationGate=async()=>({});');
 const f3=await build({[entry]:text});expect(f3.status).toBe('unknown');expect(f3.bindings).toEqual([]);
});

it('被声明的入口源字节缺失仍UNKNOWN，不保留成功绑定',async()=>{
 const f3=await build({[entry]:''});expect(f3.status).toBe('unknown');expect(f3.bindings).toEqual([]);
});

const legacyCliPath='scripts/ci/implementation-pr-gate.mjs';
const reviewedLegacyRevision='5ac11b500b77dd7ccfd89e41d964ec786c83e225';
const readReviewedLegacyCli=sha=>fixtureGit('show',`${sha}:${legacyCliPath}`);
const reviewedLegacyCli=readReviewedLegacyCli(reviewedLegacyRevision);
function legacySingleDoc(){
 const doc=yaml.load(read(workflow));doc.jobs.gate.steps=[{run:legacyRun}];delete doc.jobs.gate.env.IMPLEMENTATION_MAIN_SCOPES;return doc;
}
async function legacySingleProof(pr,doc=legacySingleDoc()){
 const overrides=new Map([[workflow,yaml.dump(doc)],[legacyCliPath,pr]]);
 return (await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,
  paths:[...new Set([...paths,entry,multi])],readSource:async path=>overrides.get(path)??read(path)})).consumers[1];
}
// 仅缓存同一不可变历史正例；每个拒绝变体都先核实其原始CLI确实被旧recipe接受。
let reviewedLegacyProof;
async function assertReviewedLegacyBaseline(){
 const proof=await (reviewedLegacyProof??=legacySingleProof(reviewedLegacyCli));
 expect(proof.status,JSON.stringify(proof.gaps)).toBe('verified');
 expect(proof.input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:legacyCliPath,kind:'direct_admission_runner'}));
}
it.each([reviewedLegacyRevision,'706f2e834afef562f4690a44e7fd1e3c80f25c83'])('旧YAML真实单scope在已审%s联合CLI时仍有来源，未运行的联合分支不冒Factory消费者',async cli=>{
 const f3=await legacySingleProof(readReviewedLegacyCli(cli));
 expect(f3.status,JSON.stringify(f3.gaps)).toBe('verified');
 expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:legacyCliPath,kind:'direct_admission_runner'}));
 expect(f3.input_relations.some(r=>r.kind==='conditional_pr_admission_runner')).toBe(false);
});
it('当前新CLI不继承旧单scope recipe的历史审定资格',async()=>{
 const candidate=readFixedExistingOpsGitFixture(fixtureGit('rev-parse','HEAD').trim());
 const current=candidate.read(legacyCliPath).toString();expect(current).not.toBe(reviewedLegacyCli);
 const f3=await legacySingleProof(current);
 expect(f3.status).toBe('unknown');expect(f3.bindings).toEqual([]);expect(f3.input_relations).toEqual([]);
 expect(f3.gaps).toContainEqual(expect.objectContaining({code:'legacy_impact_runner_unproven'}));
});

it.each(['base_guard','head_guard','mode','import'])('旧单scope拒绝来源用途闸%s被改动的未知CLI',async kind=>{
 const doc=yaml.load(read(workflow));doc.jobs.gate.steps=[{run:legacyRun}];delete doc.jobs.gate.env.IMPLEMENTATION_MAIN_SCOPES;
 const path='scripts/ci/implementation-pr-gate.mjs';
 await assertReviewedLegacyBaseline();
 const original=reviewedLegacyCli;
 const changed=kind==='base_guard'?original.replace("assertRecoveryPurpose(b,'pr');",'')
  :kind==='head_guard'?original.replace('assertRecoveryPurpose(h,mode);','')
  :kind==='mode'?original.replace('assertRecoveryPurpose(h,mode);',"assertRecoveryPurpose(h,'pr');")
  :original.replace("import {assertRecoveryPurpose} from './implementation-source-recovery.mjs';",'');
 expect(changed).not.toBe(original);
 const f3=(await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths,
  readSource:async p=>p===workflow?yaml.dump(doc):p===path?changed:read(p)})).consumers[1];
 expect(f3.status).toBe('unknown');expect(f3.bindings).toEqual([]);
});

it.each(['condition','callee','argument','else','side_effect','workflow_env','job_env','step_env','null_env','step_injection','forced_parse','undefined_shadow','forced_option','object_assign','computed_option','alias_option','entry_options','module_env','prototype_option'])('旧单scope不得把 %s 的main分支误证为未运行',async kind=>{
 await assertReviewedLegacyBaseline();
 const doc=legacySingleDoc();
 let pr=reviewedLegacyCli;
 if(kind==='condition')pr=pr.replace('options.mainScopes!==undefined','options.mainScopes===undefined');
 if(kind==='callee')pr=pr.replace('return runImplementationMainGate(options);','return otherGate(options);');
 if(kind==='argument')pr=pr.replace('return runImplementationMainGate(options);','return runImplementationMainGate({});');
 if(kind==='else')pr=pr.replace('return runImplementationMainGate(options);','return runImplementationMainGate(options);else return {};');
 if(kind==='side_effect')pr=pr.replace('if(options.mainScopes!==undefined)','options.mainScopes="injected";if(options.mainScopes!==undefined)');
 if(kind==='undefined_shadow')pr+='\nconst undefined="forced";';
 if(kind==='entry_options')pr=pr.replace('runImplementationPrGate(parseArgs(process.argv.slice(2)))',"runImplementationPrGate({mainScopes:'forced'})");
 if(kind==='module_env')pr+="\nprocess.env.IMPLEMENTATION_MAIN_SCOPES='forced';";
 if(kind==='prototype_option')pr+="\nObject.prototype.mainScopes='forced';";
 if(kind==='object_assign')pr=pr.replace('if(mainScopes!==undefined)options.mainScopes=mainScopes;', "Object.assign(options,{mainScopes:'forced'});if(mainScopes!==undefined)options.mainScopes=mainScopes;");
 if(kind==='computed_option')pr=pr.replace('if(mainScopes!==undefined)options.mainScopes=mainScopes;', "options['main'+'Scopes']='forced';if(mainScopes!==undefined)options.mainScopes=mainScopes;");
 if(kind==='alias_option')pr=pr.replace('if(mainScopes!==undefined)options.mainScopes=mainScopes;', "const alias=options;alias.mainScopes='forced';if(mainScopes!==undefined)options.mainScopes=mainScopes;");
 if(kind==='forced_option')pr=pr.replace('if(mainScopes!==undefined)options.mainScopes=mainScopes;', 'options.mainScopes="forced";');
 if(kind==='forced_parse')pr=pr.replace('process.env.IMPLEMENTATION_MAIN_SCOPES||undefined', '"forced"');
 if(kind==='null_env')doc.env={IMPLEMENTATION_MAIN_SCOPES:null};
 if(kind==='step_injection')doc.jobs.gate.steps.unshift({run:'echo IMPLEMENTATION_MAIN_SCOPES=forced >> "$GITHUB_ENV"'});
 if(kind==='workflow_env')doc.env={IMPLEMENTATION_MAIN_SCOPES:false};
 if(kind==='job_env')doc.jobs.gate.env.IMPLEMENTATION_MAIN_SCOPES='';
 if(kind==='step_env')doc.jobs.gate.steps[0].env={IMPLEMENTATION_MAIN_SCOPES:'active'};
 expect(pr!==reviewedLegacyCli||yaml.dump(doc)!==yaml.dump(legacySingleDoc())).toBe(true);
 const overrides=new Map([[workflow,yaml.dump(doc)],['scripts/ci/implementation-pr-gate.mjs',pr]]);
 const f3=(await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths,readSource:async path=>overrides.get(path)??read(path)})).consumers[1];
 expect(f3.status,JSON.stringify(f3.gaps)).toBe('unknown');expect(f3.bindings).toEqual([]);
});

it('真实当前CLI只有mainScopes缺省才走单scope，false或空值仍进入main拒绝',async()=>{
 const {runImplementationPrGate}=await import('../../../../../scripts/ci/implementation-pr-gate.mjs');
 const dir=mkdtempSync(join(tmpdir(),'legacy-main-contract-'));
 try{for(const [label,extra,code]of [['absent',{},'IMPLEMENTATION_CI_INPUT_INVALID'],['undefined',{mainScopes:undefined},'IMPLEMENTATION_CI_INPUT_INVALID'],['false',{mainScopes:false},'IMPLEMENTATION_MAIN_SCOPES_INVALID'],['empty',{mainScopes:''},'IMPLEMENTATION_MAIN_SCOPES_INVALID']])
  await expect(runImplementationPrGate({mode:'main',scope:'cecelia-kr',outputDir:join(dir,label),...extra})).rejects.toMatchObject({code});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('自身future CI完整原件必须由raw F3 collector证明typed准入调用链',async()=>{
 const {revision:future,paths:futurePaths,read:futureRead}=frozenProfile;
 const proof=await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:future,paths:futurePaths,readSource:futureRead});
 expect(proof.consumers[1].status,JSON.stringify(proof.consumers[1].gaps)).toBe('verified');
 expect(proof.consumers[1].input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:entry,kind:'ci_admission_only_native_pr_runner'}));
 expect(proof.workflows.every(w=>w.executable===false&&w.coverage.status==='unknown')).toBe(true);
});

// 完整active profile的每个成员独立改变都会清空候选关系；不靠foreign inactive资格。
{
 const fixture=frozenProfile,active={basicCi:true,parse:text=>acorn(text,{ecmaVersion:'latest',sourceType:'module'}),revision:fixture.revision};
 it('自身typed active完整tuple保留same revision真实调用边',async()=>{
  const relations=[];expect(await collectNativeFutureImpactSources({...active,read:fixture.read,relations})).toBe(true);
  expect(relations).toContainEqual(expect.objectContaining({input_path:'packages/brain/src/lib/existing-ops-registration.js',kind:'sealed_ci_admission_import'}));
 });
 for(const path of [".github/workflows/ci-admission-baseline.yml",".github/workflows/implementation-impact.yml","scripts/ci/implementation-multi-pr-gate.mjs","scripts/ci/implementation-pr-gate.mjs","scripts/ci/implementation-multi-scope.mjs","scripts/ci/implementation-snapshot.mjs","scripts/ci/implementation-scratch.mjs","scripts/ci/implementation-gate.mjs","scripts/ci/implementation-pr-baseline.mjs","scripts/ci/implementation-infra-inputs.mjs","scripts/ci/implementation-skill-source.mjs","scripts/ci/ci-admission-inputs.mjs","scripts/ci/ci-admission-handoff.mjs","scripts/ci/ci-admission-artifact.mjs","scripts/ci/ci-admission-envelope.mjs","scripts/ci/ci-admission-authority.mjs","scripts/ci/ci-admission-archive.mjs","scripts/ci/ci-admission-scratch.mjs","scripts/ci/ci-admission-seed.mjs","scripts/ci/ci-admission-builder.mjs","scripts/ci/ci-admission-worker.mjs","scripts/ci/ci-admission-worker-runner.mjs","scripts/ci/ci-admission-publisher.mjs","scripts/ci/implementation-verification-inputs.mjs","scripts/ci/implementation-verification-context.mjs","scripts/ci/implementation-verification-selectors.mjs","scripts/ci/implementation-verification-retirements.mjs","scripts/ci/implementation-auxiliary-evidence.mjs","scripts/ci/fixed-local-git.mjs","packages/brain/src/lib/existing-ops-registration.js","packages/brain/src/lib/implementation-ci-snapshot.js","scripts/ci/config/ci-admission-registry.json"])it(`自身active拒绝单独篡改${path}`,async()=>{
  const relations=[];expect(await collectNativeFutureImpactSources({...active,read:async p=>(await fixture.read(p))+(p===path?'\n// unreviewed active bytes':''),relations})).toBe(false);expect(relations).toEqual([]);
 });
 it('新active入口没有同revision完整Basic前置不得借legacy授信',async()=>{
  const relations=[];expect(await collectNativeFutureImpactSources({...active,basicCi:false,read:fixture.read,relations})).toBe(false);expect(relations).toEqual([]);
 });
}

it('真实selected测试读取gzip数据且loader不执行数据并恢复描述符',async()=>{
 const require=createRequire(new URL('./helpers/future-active-git.js',import.meta.url));
 const target=require.resolve('../../../../../../scripts/ci/__tests__/fixtures/future-active-source.json.gz');
 const extension=Object.getOwnPropertyDescriptor(require.extensions,'.gz'),cache=Object.getOwnPropertyDescriptor(require.cache,target);
 expect(Buffer.isBuffer(readFrozenFutureBytes(require))).toBe(true);
 expect(Object.getOwnPropertyDescriptor(require.extensions,'.gz')).toEqual(extension);expect(Object.getOwnPropertyDescriptor(require.cache,target)).toEqual(cache);
 // 指向非目标不能交给JS编译：在调用者边界主动请求同扩展的另一路径。
 const fake=()=>require.extensions['.gz']({},target+'.other');Object.assign(fake,{resolve:require.resolve,extensions:require.extensions,cache:require.cache});
 expect(()=>readFrozenFutureBytes(fake)).toThrow('FUTURE_DATA_TARGET');
 expect(Object.getOwnPropertyDescriptor(require.extensions,'.gz')).toEqual(extension);expect(Object.getOwnPropertyDescriptor(require.cache,target)).toEqual(cache);

});
for(const[name,path,before,after]of[
 ['跳过buildPr','scripts/ci/implementation-pr-gate.mjs','h=await buildPrImplementationSnapshot(scratch.db,h,head,repoRoot)','h=h'],
 ['缺三scope','scripts/ci/implementation-multi-pr-gate.mjs','["cecelia-kr","cecelia-factory","cecelia-infra"]','["cecelia-factory"]'],
 ['偷换snapshot','scripts/ci/implementation-multi-pr-gate.mjs','snapshotBase:snapshot,snapshotHead:snapshot','snapshotBase:snapshot,snapshotHead:{}'],
 ['main用途','scripts/ci/implementation-multi-pr-gate.mjs',"if(mode!=='pr')fail('IMPACT_MULTISCOPE_ADMISSION_ONLY')","if(false)fail('IMPACT_MULTISCOPE_ADMISSION_ONLY')"],
 ['脱离sameDB','scripts/ci/ci-admission-inputs.mjs',"{db:scratch.db,usage:'pr'}","{db:{},usage:'pr'}"],
 ['来源错误','scripts/ci/implementation-snapshot.mjs','readSource:nativeRead','readSource:read'],
 ['删除真实注册','scripts/ci/ci-admission-builder.mjs','await registerExistingOpsSources(db,','await fakeRegistration(db,'],
 ['提前return','scripts/ci/implementation-multi-pr-gate.mjs','return withCiAdmissionInputsScratch(handle,','return {}; return withCiAdmissionInputsScratch(handle,'],
 ['只留注释调用','scripts/ci/implementation-pr-gate.mjs','return implementationPrEvidence(options,false,{db:options.db});','return {}; /* implementationPrEvidence(options,false,{db:options.db}); */'],
])it(`自身active拒绝${name}`,async()=>{
 const text=await frozenProfile.read(path);expect(text.includes(before)).toBe(true);const relations=[];
 expect(await collectNativeFutureImpactSources({basicCi:true,parse:text=>acorn(text,{ecmaVersion:'latest',sourceType:'module'}),revision:frozenProfile.revision,relations,read:async p=>p===path?text.replace(before,after):frozenProfile.read(p)})).toBe(false);expect(relations).toEqual([]);
});
it('未来profile失败不得借旧multi/foreign条件回落，整个F3绑定必须清空',async()=>{
 const pr='scripts/ci/implementation-multi-pr-gate.mjs';
 const proof=await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:frozenProfile.revision,paths:frozenProfile.paths,readSource:async p=>p===pr?(await frozenProfile.read(p))+'\n// unreviewed active controller':frozenProfile.read(p)});
 expect(proof.consumers[1].status).toBe('unknown');expect(proof.consumers[1].bindings).toEqual([]);expect(proof.consumers[1].input_relations).toEqual([]);
});

let capturedRuntime,historicalRuntime;
afterAll(()=>{capturedRuntime?.close();historicalRuntime?.close();});
async function ownRuntime(historical=false){
 let entry=historical?historicalRuntime:capturedRuntime;
 if(!entry){entry=materializeFrozenCollector(root,{historical});if(historical)historicalRuntime=entry;else capturedRuntime=entry;}
 const url=pathToFileURL(entry.sourceFile).href;expect(url.startsWith(pathToFileURL(entry.checkout+'/').href)).toBe(true);
 entry.api??=await import(/* @vite-ignore */ url);
 entry.workspace??=await import(/* @vite-ignore */ pathToFileURL(entry.workspaceFile).href);
 return entry;
}
const typedOutputProfile=frozenTypedOutputFutureGit(root);
it('新完整typed输出guard与resolver由fixture自身16runtime及raw F3实际验证',async()=>{
 const runtime=await ownRuntime(),profile=runtime.input;
 const {readNativeConsumerRuntime}=await import(/* @vite-ignore */ pathToFileURL(runtime.runtimeFile).href);
 const loaded=readNativeConsumerRuntime();expect(loaded.files).toHaveLength(16);
 for(const file of loaded.files)expect(createHash('sha256').update(await profile.read(file.path)).digest('hex')).toBe(file.sha256);
 const proof=await runtime.api.buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:profile.revision,paths:profile.paths,readSource:profile.read});
 await new Promise(resolve=>nativeSetImmediate(resolve)); // 同原raw wrapper，交还默认30s计时器而不延长预算。
 expect(proof.consumers[1].status,JSON.stringify(proof.consumers[1].gaps)).toBe('verified');
 expect(proof.consumers[1].input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:entry,kind:'ci_admission_only_native_pr_runner'}));
 expect(proof.workflows.every(w=>w.executable===false&&w.coverage.status==='unknown')).toBe(true);
});
const typedOutputMembers=[".github/workflows/ci-admission-baseline.yml", ".github/workflows/implementation-impact.yml", "scripts/ci/implementation-multi-pr-gate.mjs", "scripts/ci/implementation-pr-gate.mjs", "scripts/ci/implementation-multi-scope.mjs", "scripts/ci/implementation-snapshot.mjs", "scripts/ci/implementation-scratch.mjs", "scripts/ci/implementation-gate.mjs", "scripts/ci/implementation-pr-baseline.mjs", "scripts/ci/implementation-infra-inputs.mjs", "scripts/ci/implementation-skill-source.mjs", "scripts/ci/ci-admission-inputs.mjs", "scripts/ci/ci-admission-handoff.mjs", "scripts/ci/ci-admission-artifact.mjs", "scripts/ci/ci-admission-envelope.mjs", "scripts/ci/ci-admission-authority.mjs", "scripts/ci/ci-admission-archive.mjs", "scripts/ci/ci-admission-scratch.mjs", "scripts/ci/ci-admission-seed.mjs", "scripts/ci/ci-admission-builder.mjs", "scripts/ci/ci-admission-worker.mjs", "scripts/ci/ci-admission-worker-runner.mjs", "scripts/ci/ci-admission-publisher.mjs", "scripts/ci/implementation-verification-inputs.mjs", "scripts/ci/implementation-verification-context.mjs", "scripts/ci/implementation-verification-selectors.mjs", "scripts/ci/implementation-verification-retirements.mjs", "scripts/ci/implementation-auxiliary-evidence.mjs", "scripts/ci/fixed-local-git.mjs", "packages/brain/src/lib/existing-ops-registration.js", "packages/brain/src/lib/implementation-ci-snapshot.js", "scripts/ci/config/ci-admission-registry.json"];
for(const path of typedOutputMembers)it(`新输出profile独立篡改拒绝${path}`,async()=>{
 const runtime=await ownRuntime(),relations=[];expect(await runtime.workspace.collectNativeFutureImpactSources({basicCi:true,parse:text=>acorn(text,{ecmaVersion:'latest',sourceType:'module'}),revision:typedOutputProfile.revision,relations,
  read:async p=>(await typedOutputProfile.read(p))+(p===path?'\n// unreviewed typed output':'' )})).toBe(false);expect(relations).toEqual([]);
});
for(const path of ['scripts/ci/implementation-multi-pr-gate.mjs','scripts/ci/implementation-pr-baseline.mjs'])it(`新旧输出controller不能单独混搭${path}`,async()=>{
 const relations=[];expect(await collectNativeFutureImpactSources({basicCi:true,parse:text=>acorn(text,{ecmaVersion:'latest',sourceType:'module'}),revision:typedOutputProfile.revision,relations,
  read:async p=>p===path?frozenFutureGit(root).read(p):typedOutputProfile.read(p)})).toBe(false);expect(relations).toEqual([]);
});

it('未发布且已知错误的旧active1f完整组合在新D不得继续取得资格',async()=>{
 const old=frozenFutureGit(root),relations=[];
 expect(await collectNativeFutureImpactSources({basicCi:true,parse:text=>acorn(text,{ecmaVersion:'latest',sourceType:'module'}),revision:old.revision,read:old.read,relations})).toBe(false);
 expect(relations).toEqual([]);
});

it('固定已发布BC旧collector仅历史回放旧1f完整输入，不授予当前D active资格',async()=>{
 const runtime=await ownRuntime(true),profile=runtime.input;
 expect(runtime.git('rev-parse','HEAD')).toBe('bc597b839142052c33689750a33472f73bbd89d1');
 const proof=await runtime.api.buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:profile.revision,paths:profile.paths,readSource:profile.read});
 await new Promise(resolve=>nativeSetImmediate(resolve)); // 同原raw wrapper，交还默认30s计时器而不延长预算。
 expect(proof.consumers[1].status,JSON.stringify(proof.consumers[1].gaps)).toBe('verified');
 const relations=[];expect(await collectNativeFutureImpactSources({basicCi:true,parse:text=>acorn(text,{ecmaVersion:'latest',sourceType:'module'}),revision:profile.revision,read:profile.read,relations})).toBe(false);expect(relations).toEqual([]);
});
