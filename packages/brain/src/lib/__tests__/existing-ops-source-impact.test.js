import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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
const fixtureRead=path=>model.get(path)??read(path);
const build=async overrides=>(await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths:[...new Set([...paths,...model.keys()])],readSource:async path=>overrides?.[path]??fixtureRead(path)})).consumers[1];
it('F3只以固定PR条件runner和实际AST调用链认领多scope脚本，完整工厂仍不可执行',async()=>{
 expect(createHash('sha256').update(approvedRun).digest('hex')).toBe('8e54cd03b82a18c8c94eaf0a438744193e093d680aa133f416e33ba4ca3ae21d');
 const f3=await build();expect(f3.status,JSON.stringify(f3.gaps)).toBe('verified');
 for(const path of [workflow,entry,multi,'scripts/ci/implementation-pr-gate.mjs','scripts/ci/implementation-gate.mjs'])expect(f3.bindings.some(b=>b.path===path),path).toBe(true);
 expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:entry,kind:'conditional_pr_admission_runner'}));
 expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:entry,input_path:multi,kind:'reachable_named_import_call'}));
});
it.each(['comment','dead_branch','wrong_env','wrong_schema'])('PR runner %s变化不得用旧字符串伪认领',async kind=>{
 const doc=yaml.load(fixtureRead(workflow)),job=doc.jobs.gate;
 const step=job.steps.find(s=>typeof s.run==='string'&&s.run.includes('implementation-multi-pr-gate.mjs'));
 if(kind==='comment')step.run=step.run.split('\n').map(l=>'# '+l).join('\n');
 if(kind==='dead_branch')step.run=step.run.replace('[[ "$MODE" == pr && -n "$ADMISSION_SCOPES" ]]','false');
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
