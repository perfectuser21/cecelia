import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import {buildExistingOpsSources} from '../existing-ops-source.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const paths=execFileSync('git',['ls-tree','-rz','--name-only',revision],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const cache=new Map();
const read=path=>{if(!cache.has(path))cache.set(path,execFileSync('git',['show',`${revision}:${path}`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}));return cache.get(path);};
const workflow='.github/workflows/implementation-impact.yml';
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
 const doc=yaml.load(read(workflow));doc.jobs.gate.steps=[{run:legacyRun}];
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

it('旧YAML真实单scope在已安装联合CLI时仍有来源，未运行的联合分支不冒Factory消费者',async()=>{
 const doc=yaml.load(read(workflow));doc.jobs.gate.steps=[{run:legacyRun}];
 const overrides=new Map([[workflow,yaml.dump(doc)],...['scripts/ci/implementation-pr-gate.mjs',entry,multi].map(path=>[path,readFileSync(new URL(path,new URL('../../../../../',import.meta.url)),'utf8')])]);
 const f3=(await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths:[...new Set([...paths,entry,multi])],readSource:async path=>overrides.get(path)??read(path)})).consumers[1];
 expect(f3.status,JSON.stringify(f3.gaps)).toBe('verified');
 expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:'scripts/ci/implementation-pr-gate.mjs',kind:'direct_admission_runner'}));
 expect(f3.input_relations.some(r=>r.kind==='conditional_pr_admission_runner')).toBe(false);
});
