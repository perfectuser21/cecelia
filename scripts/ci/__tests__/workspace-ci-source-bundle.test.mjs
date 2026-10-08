import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { extractWorkspaceCiSourceBundle, F3_IDENTITY } from '../workspace-ci-source-bundle.mjs';

const WR='perfectuser21/zenithjoy-workspace', BR='perfectuser21/cecelia';
const specs=[['implementation-impact','impact','gate','implementation-pr-gate.mjs'],['pilot-release-verification','verify','verify','pilot-release-verification.mjs']];
const hash=s=>createHash('sha256').update(s).digest('hex');
function git(root,...args){return execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();}
function tree(root,files){mkdirSync(root,{recursive:true});git(root,'init','-q');for(const [p,s] of Object.entries(files)){mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);}git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','固定来源');return git(root,'rev-parse','HEAD');}
function fixture(t,change=()=>{}){
 const dir=mkdtempSync(join(tmpdir(),'workspace-ci-bundle-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const bf={};for(const [name,,,runner] of specs){bf[`.github/workflows/${name}.yml`]=`name: ${name}\non:\n  workflow_call:\n    inputs:\n      source_repo: {required: true, type: string}\n      scope: {required: true, type: string}\n      head_revision: {required: true, type: string}\n      tooling_revision: {required: true, type: string}\n${name==='implementation-impact'?'      base_revision: {required: true, type: string}\n      mode: {required: true, type: string}\n':''}jobs:\n  ${name==='implementation-impact'?'gate':'verify'}:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          repository: perfectuser21/cecelia\n          ref: \${{ inputs.tooling_revision || github.sha }}\n          path: tooling\n      - run: node tooling/scripts/ci/${runner} --repo-root "$PWD/source"\n`;
 bf[`scripts/ci/${runner}`]='export const fixed_source = true;\n';}
 const brainRoot=join(dir,'brain');const brainRevision=tree(brainRoot,bf);const wf={};
 for(const [name,job] of specs){const reader=`scripts/ci/__tests__/${name==='implementation-impact'?'implementation-impact':'pilot-release'}-workflow.test.mjs`;wf[reader]=`import {test} from 'node:test';\nimport {readFileSync,existsSync} from 'node:fs';\nimport YAML from 'yaml';\nconst file=new URL('../../../.github/workflows/${name}.yml',import.meta.url);\nfunction config(){if(!existsSync(file))throw Error('missing');return YAML.parse(readFileSync(file,'utf8'));}\ntest('真实caller协议',()=>{config();});\n`;
 wf[`.github/workflows/${name}.yml`]=`name: ${name}\non:\n  ${name==='implementation-impact'?'pull_request:\n    branches: [main]\n  ':''}push:\n    branches: [main]\n  workflow_dispatch:\npermissions: {contents: read, actions: read}\njobs:\n  caller-contract:\n    steps:\n      - run: node --test ${reader}\n  ${job}:\n    needs: caller-contract\n    uses: ${BR}/.github/workflows/${name}.yml@${brainRevision}\n    with:\n      source_repo: ${WR}\n      scope: zenithjoy\n      head_revision: \${{ github.sha }}\n      tooling_revision: ${brainRevision}\n${name==='implementation-impact'?'      base_revision: \${{ github.event.before }}\n      mode: main\n':''}`;}
 change(wf,bf,brainRevision);const workspaceRoot=join(dir,'workspace'),workspaceRevision=tree(workspaceRoot,wf);
 const reads=[];return {wf,bf,brainRevision,workspaceRevision,reads, options:{workspace:{repo:WR,revision:workspaceRevision},brain:{repo:BR,revision:brainRevision},identity:{...F3_IDENTITY},readSource:async({repo,revision,path})=>{reads.push({repo,revision,path});return execFileSync('git',['show',`${revision}:${path}`],{cwd:repo===WR?workspaceRoot:brainRoot});}}};
}
test('真实两Git固定树：来源repo/revision/hash分离，既有F3 consumer不可执行',async t=>{
 const f=fixture(t),r=await extractWorkspaceCiSourceBundle(f.options);
 assert.equal(r.status,'verified',JSON.stringify(r.gaps));assert.deepEqual(r.gaps,[]);assert.equal(r.executable,false);
 assert.deepEqual(r.source_set,[f.options.workspace,f.options.brain]);assert.equal(r.consumer.reference_id,F3_IDENTITY.reference_id);
 assert.equal(r.consumer.definition_scope,'consumer_evidence');assert.equal(r.workflow_coverage.status,'unknown');assert.equal(r.workflow_coverage.unverified_reference_ids.length,3);
 for(const b of r.consumer.bindings){assert.equal(b.revision,b.repo===WR?f.workspaceRevision:f.brainRevision);assert.match(b.content_sha256,/^[a-f0-9]{64}$/);assert.equal(b.digest,`sha256:${b.content_sha256}`);}
 assert.equal(r.consumer.input_relations.filter(x=>x.kind==='fixed_reusable_workflow').length,2);
 assert.equal(r.consumer.bindings.find(x=>x.path==='scripts/ci/implementation-pr-gate.mjs').content_sha256,hash(f.bf['scripts/ci/implementation-pr-gate.mjs']));
 assert.equal(f.reads.some(x=>x.path.includes('latest')),false);
});
for(const [name,mutate,code] of [
 ['uses与tooling_revision不一致',(w)=>{w['.github/workflows/implementation-impact.yml']=w['.github/workflows/implementation-impact.yml'].replace(/tooling_revision: [a-f0-9]{40}/,'tooling_revision: '+ 'a'.repeat(40));},'CALLER_PIN_MISMATCH'],
 ['latest不能冒充固定来源',(w)=>{w['.github/workflows/implementation-impact.yml']=w['.github/workflows/implementation-impact.yml'].replace(/@[a-f0-9]{40}/,'@main');},'CALLER_PIN_MISMATCH'],
 ['缺真实required caller链',(w)=>{w['.github/workflows/implementation-impact.yml']=w['.github/workflows/implementation-impact.yml'].replace('needs: caller-contract','needs: other');},'CALLER_REQUIRED_JOB_MISSING'],
 ['continue-on-error拒绝',(w)=>{w['.github/workflows/implementation-impact.yml']=w['.github/workflows/implementation-impact.yml'].replace('needs: caller-contract','needs: caller-contract\n    continue-on-error: true');},'CALLER_FAILURE_BYPASS'],
 ['伪reader仅字符串不能证明实读',(w)=>{w['scripts/ci/__tests__/implementation-impact-workflow.test.mjs']='export const proof="YAML.parse(readFileSync(new URL(\\\"../../../.github/workflows/implementation-impact.yml\\\",import.meta.url)))";';},'READER_INPUT_UNPROVEN'],
])test(`拒认：${name}`,async t=>{const f=fixture(t,mutate),r=await extractWorkspaceCiSourceBundle(f.options);assert.equal(r.status,'unknown');assert.ok(r.gaps.some(x=>x.code===code),JSON.stringify(r.gaps));assert.equal(r.executable,false);});
test('错误既有F3身份不能偷偷创建另一Activity',async t=>{const f=fixture(t);f.options.identity.activity_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const r=await extractWorkspaceCiSourceBundle(f.options);assert.equal(r.status,'unknown');assert.ok(r.gaps.some(x=>x.code==='F3_IDENTITY_MISMATCH'));assert.equal(f.reads.length,0);});
test('未固定source SHA不读任何源码，保持unknown',async t=>{const f=fixture(t);f.options.workspace.revision='main';const r=await extractWorkspaceCiSourceBundle(f.options);assert.equal(r.status,'unknown');assert.ok(r.gaps.some(x=>x.code==='SOURCE_IDENTITY_INVALID'));assert.equal(f.reads.length,0);});

test('固定callee源码不可读必须缺口，不执行其他文件兜底',async t=>{const f=fixture(t),read=f.options.readSource;f.options.readSource=async q=>{if(q.path==='scripts/ci/implementation-pr-gate.mjs')throw Error('missing fixed source');return read(q);};const r=await extractWorkspaceCiSourceBundle(f.options);assert.equal(r.status,'unknown');assert.ok(r.gaps.some(x=>x.code==='SOURCE_READ_FAILED'));});
