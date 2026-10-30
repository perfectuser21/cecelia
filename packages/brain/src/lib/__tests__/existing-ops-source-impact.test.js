import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import { buildExistingOpsSources } from './helpers/existing-ops-proof-builder.js';
import { fixtureGit, readFixedExistingOpsGitFixture } from './helpers/fixed-existing-ops-git-fixture.js';
const { revision, paths, read } = readFixedExistingOpsGitFixture();
const workflow='.github/workflows/implementation-impact.yml';
it('已知历史Git fixture 保持 F2/F3 消费者来源协议',async()=>{
 const proof=await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths,readSource:async path=>read(path)});
 expect(proof.consumers.every(c=>c.status==='verified'),JSON.stringify(proof.consumers.map(c=>c.gaps))).toBe(true);
});

it('当前HEAD新CI尚未准入，不得继承历史Git fixture的消费者资格', async () => {
 const candidate = readFixedExistingOpsGitFixture(fixtureGit('rev-parse', 'HEAD').trim());
 expect(candidate.revision).not.toBe(revision);
 const proof = await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',
  revision:candidate.revision,paths:candidate.paths,readSource:candidate.read});
 expect(proof.revision).toBe(candidate.revision);
 for (const consumer of proof.consumers) {
  expect(consumer.status, JSON.stringify(consumer.gaps)).toBe('unknown');
  expect(consumer.gaps.length).toBeGreaterThan(0);
  expect(consumer.bindings).toEqual([]);
  expect(consumer.input_relations).toEqual([]);
 }
 expect(proof.consumers[0].gaps).toContainEqual({code:'isolated_staging_source_unproven'});
 expect(proof.consumers[1].gaps).toContainEqual({code:'nightly_full_unit_unproven'});
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

it.each(['current','706f2e834afef562f4690a44e7fd1e3c80f25c83'])('旧YAML真实单scope在已审%s联合CLI时仍有来源，未运行的联合分支不冒Factory消费者',async cli=>{
 const doc=yaml.load(read(workflow));doc.jobs.gate.steps=[{run:legacyRun}];delete doc.jobs.gate.env.IMPLEMENTATION_MAIN_SCOPES;
 const overrides=new Map([[workflow,yaml.dump(doc)],...['scripts/ci/implementation-pr-gate.mjs',entry,multi].map(path=>[path,readFileSync(new URL(path,new URL('../../../../../',import.meta.url)),'utf8')])]);
 if(cli!=='current')overrides.set('scripts/ci/implementation-pr-gate.mjs',fixtureGit('show',`${cli}:scripts/ci/implementation-pr-gate.mjs`));
 const f3=(await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths:[...new Set([...paths,entry,multi])],readSource:async path=>overrides.get(path)??read(path)})).consumers[1];
 expect(f3.status,JSON.stringify(f3.gaps)).toBe('verified');
 expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:'scripts/ci/implementation-pr-gate.mjs',kind:'direct_admission_runner'}));
 expect(f3.input_relations.some(r=>r.kind==='conditional_pr_admission_runner')).toBe(false);
});

it.each(['base_guard','head_guard','mode','import'])('旧单scope拒绝来源用途闸%s被改动的未知CLI',async kind=>{
 const doc=yaml.load(read(workflow));doc.jobs.gate.steps=[{run:legacyRun}];delete doc.jobs.gate.env.IMPLEMENTATION_MAIN_SCOPES;
 const path='scripts/ci/implementation-pr-gate.mjs';
 const original=readFileSync(new URL(path,new URL('../../../../../',import.meta.url)),'utf8');
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
 const doc=yaml.load(read(workflow));doc.jobs.gate.steps=[{run:legacyRun}];delete doc.jobs.gate.env.IMPLEMENTATION_MAIN_SCOPES;
 let pr=readFileSync(new URL('scripts/ci/implementation-pr-gate.mjs',new URL('../../../../../',import.meta.url)),'utf8');
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
