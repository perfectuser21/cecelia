import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,existsSync,unlinkSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {authorityFixture} from './fixtures/ci-admission-authority.mjs';
import * as authority from '../ci-admission-authority.mjs';
import {publishCiAdmissionBaseline} from '../ci-admission-publisher.mjs';
import {createCiAdmissionDraft} from '../ci-admission-envelope.mjs';
import {admissionFixture} from './fixtures/ci-admission-envelope.mjs';
import {attachCiArchive} from './fixtures/ci-admission-archive.mjs';
import {readCiAdmissionBaseline} from '../ci-admission-artifact.mjs';
import {stepSha256} from '../../../packages/brain/scripts/sync-steps-from-workspace.mjs';
const repoRoot=fileURLToPath(new URL('../../..',import.meta.url)),prefix='repos/perfectuser21/cecelia';
const recipe=execFileSync('git',['show','b217cd52336767b9637410ef921397a0e9297f2b:.github/workflows/ci.yml'],{cwd:repoRoot});
function fixture(t,{bytes=recipe,symlink=false,missing=false}={}){
 const f=authorityFixture(t),path=join(f.root,'.github/workflows/ci.yml');mkdirSync(dirname(path),{recursive:true});
 if(existsSync(path))unlinkSync(path);
 if(missing){}else if(symlink){writeFileSync(join(f.root,'recipe'),bytes);symlinkSync('../../recipe',path);}else writeFileSync(path,bytes);
 writeFileSync(join(f.root,'source'),'actual source CI');f.git('add','.');f.git('commit','-qm','actual old CI source');f.source=f.git('rev-parse','HEAD');
 if(existsSync(path))unlinkSync(path);writeFileSync(path,'name: CI\non: {push: {branches: [main]}}\njobs: {source: {name: 源码保底通过, runs-on: ubuntu-latest, steps: [{run: true}]}}\n');
 writeFileSync(join(f.root,'later-control'),'publisher can be newer');f.git('add','.');f.git('commit','-qm','later publisher control');f.control=f.git('rev-parse','HEAD');
 f.data.get(`${prefix}/branches/main`).commit.sha=f.control;
 for(const [runId,checkId,revision,name]of [[11,34,f.source,'ci-passed'],[22,44,f.control,'ci-admission-baseline']]){
  const run=f.data.get(`${prefix}/actions/runs/${runId}`),check=f.data.get(`${prefix}/check-runs/${checkId}`),job=f.data.get(`${prefix}/actions/runs/${runId}/attempts/1/jobs?per_page=100`).jobs[0];
  run.head_sha=revision;check.head_sha=revision;job.head_sha=revision;check.name=name;job.name=name;
 }
 f.data.get(`${prefix}/actions/runs/22`).status='in_progress';
 f.options={repoRoot:f.root,sourceRevision:f.source,controlRevision:f.control,sourceRunId:11,publisher:{runId:22,attempt:1,phase:'publishing'}};
 const sourceRoot=join(f.root,'detached-source');f.git('worktree','add','--quiet','--detach',sourceRoot,f.source);
 f.publisher={sourceRoot,controlRoot:f.root,sourceRevision:f.source,controlRevision:f.control,sourceRunId:11,publisherRunId:22,publisherAttempt:1,
  repository:'perfectuser21/cecelia',eventName:'workflow_run',event:{action:'completed',workflow_run:structuredClone(f.data.get(`${prefix}/actions/runs/11`))},outputDir:join(f.root,'publication')};
 f.publication=()=>authority.verifyCiAdmissionAuthority(f.options,{api:f.api});
 return f;
}
test('固定旧recipe source与较晚新recipe control按source选legacy完整CI能力',async t=>{
 const f=fixture(t),cap=await f.publication(),proof=authority.ciAuthorityProof(cap);
 assert.notEqual(createHash('sha256').update(f.git('show',f.control+':.github/workflows/ci.yml')).digest('hex'),createHash('sha256').update(recipe).digest('hex'));
 assert.equal(proof.ci.profile,'legacy_full_ci_v1');assert.equal(proof.ci.provider_name,'ci-passed');assert.equal(proof.ci.recipe_sha256,'91eb26e207d3f15cf810fe1dec4e9137d0f31d1c8004f7938ded7cb7112335e2');
 assert.equal(proof.source_revision,f.source);assert.equal(proof.control_revision,f.control);assert.throws(()=>authority.ciAuthorityProof({...cap}),/AUTHORITY_REQUIRED/);
});
for(const variant of ['recipe-byte','missing-recipe','symlink','wrong-app','failed-job','wrong-job','wrong-check-link','wrong-source-path','unprotected','pr-event','nonpublishing','artifact'])test('旧完整CI profile精确边界拒绝：'+variant,async t=>{
 const f=fixture(t,{bytes:variant==='recipe-byte'?Buffer.concat([recipe,Buffer.from('\n# drift\n')]):recipe,symlink:variant==='symlink',missing:variant==='missing-recipe'});
 if(variant==='wrong-app')f.data.get(`${prefix}/check-runs/34`).app.id=1;
 if(variant==='failed-job')f.data.get(`${prefix}/actions/runs/11/attempts/1/jobs?per_page=100`).jobs[0].conclusion='failure';
 if(variant==='wrong-job')f.data.get(`${prefix}/actions/runs/11/attempts/1/jobs?per_page=100`).jobs[0].name='源码保底通过';
 if(variant==='wrong-check-link')f.data.get(`${prefix}/check-runs/34`).details_url+='-fake';
 if(variant==='wrong-source-path')f.data.get(`${prefix}/actions/runs/11`).path='.github/workflows/other.yml';
 if(variant==='unprotected')f.data.get(`${prefix}/branches/main`).protected=false;
 if(variant==='pr-event')f.data.get(`${prefix}/actions/runs/11`).event='pull_request';
 if(variant==='nonpublishing')delete f.options.publisher.phase;
 if(variant==='artifact')f.options.artifactId=1;
 await assert.rejects(f.publication(),/CI_ADMISSION_|FIXED_GIT_/);
});
test('真实CLI未知旧recipe不能用ci-passed冒名发布，退出失败且无输出或目录',async t=>{
 const f=fixture(t,{bytes:Buffer.concat([recipe,Buffer.from('\n# unreviewed recipe\n')])}),bin=join(f.root,'bin');mkdirSync(bin);
 const database=join(f.root,'api.json');writeFileSync(database,JSON.stringify([...f.data]));
 writeFileSync(join(bin,'gh'),`#!${process.execPath}\nconst fs=require('node:fs');const data=new Map(JSON.parse(fs.readFileSync(${JSON.stringify(database)})));const key=process.argv.at(-1);if(!data.has(key))process.exit(9);process.stdout.write(JSON.stringify(data.get(key)));`,{mode:0o700});
 const event=join(f.root,'event.json'),output=join(f.root,'github-output');writeFileSync(event,JSON.stringify(f.publisher.event));
 assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(new URL('../ci-admission-publisher.mjs',import.meta.url)),f.publisher.sourceRoot,f.root,f.publisher.outputDir],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{PATH:bin+':'+process.env.PATH,GITHUB_EVENT_PATH:event,GITHUB_OUTPUT:output,GITHUB_REPOSITORY:f.publisher.repository,GITHUB_EVENT_NAME:'workflow_run',GITHUB_SHA:f.control,GITHUB_RUN_ID:'22',GITHUB_RUN_ATTEMPT:'1'},timeout:15000}),error=>error.status===1&&String(error.stderr).includes('CI_ADMISSION_PROVIDER_AMBIGUOUS'));
 assert.equal(existsSync(output),false);assert.equal(existsSync(f.publisher.outputDir),false);
});

for(const side of ['source','control'])test('旧完整CI也不能掩盖实际checkout漂移：'+side,async t=>{
 const f=fixture(t);writeFileSync(join(side==='source'?f.publisher.sourceRoot:f.root,'source'),'dirty tracked bytes');let workers=0;
 await assert.rejects(publishCiAdmissionBaseline(f.publisher,{api:f.api,runWorker:()=>{workers++;}}),/CI_ADMISSION_PUBLISHER_CHECKOUT/);
 assert.equal(workers,0);assert.equal(existsSync(f.publisher.outputDir),false);
});

const legacyEnvelope=t=>admissionFixture(t,{sourceCiRecipe:recipe,sourceCiProvider:'ci-passed'});
function artifactInputs(f){
 const prefix='repos/perfectuser21/cecelia/actions',artifact=f.data.get(prefix+'/artifacts/77');
 f.data.set(prefix+`/artifacts?name=implementation-ci-admission-baseline-${f.source}&per_page=100`,{total_count:1,artifacts:[structuredClone(artifact)]});
 return {options:{revision:f.source,repoRoot:f.root,controlRoot:f.root},deps:{api:f.api,download:async path=>Buffer.from(f.data.get(path))}};
}
test('旧完整CI publisher仍真实调用worker边界并只写CI-only envelope与完整profile',async t=>{
 const f=await legacyEnvelope(t),sourceRoot=join(f.root,'source-checkout');f.git('worktree','add','--quiet','--detach',sourceRoot,f.source);
 f.data.get(`${prefix}/actions/runs/22`).status='in_progress';
 const draft=await createCiAdmissionDraft({controlRoot:f.root,controlRevision:f.control,sourceRevision:f.source,sourceTree:f.git('rev-parse',f.source+'^{tree}'),snapshots:f.snapshots,executions:f.executions});let workers=0;
 const o={repository:'perfectuser21/cecelia',eventName:'workflow_run',event:{action:'completed',workflow_run:structuredClone(f.data.get(`${prefix}/actions/runs/11`))},sourceRoot,controlRoot:f.root,sourceRevision:f.source,controlRevision:f.control,sourceRunId:11,publisherRunId:22,publisherAttempt:1,outputDir:join(f.root,'publication')};
 const result=await publishCiAdmissionBaseline(o,{api:f.api,runWorker:async()=>{workers++;return structuredClone(draft);}});
 assert.equal(workers,1);assert.equal(result.published,true);assert.equal(result.purpose,'ci_admission_only');assert.deepEqual(readdirSync(o.outputDir).sort(),['assertions.json','ci-admission.json']);
 assert.equal(JSON.parse(readFileSync(join(o.outputDir,'ci-admission.json'))).ci_authority.ci.profile,'legacy_full_ci_v1');
});
test('正式artifact reader同样重推旧完整CI profile，不能只有publishing接受',async t=>{
 const f=await legacyEnvelope(t),input=artifactInputs(f),result=await readCiAdmissionBaseline(input.options,input.deps);
 assert.equal(result.envelope.ci_purpose,'ci_admission_only');assert.equal(result.envelope.ci_authority.ci.profile,'legacy_full_ci_v1');assert.equal(result.envelope.ci_authority.ci.provider_name,'ci-passed');assert.equal(result.envelope.ci_authority.ci.recipe_sha256,createHash('sha256').update(recipe).digest('hex'));
});
for(const field of ['profile','provider_name','recipe_sha256'])test('即使重封ZIP和外层摘要也不能篡改旧profile字段：'+field,async t=>{
 const f=await legacyEnvelope(t),body=structuredClone(f.body);body.ci_authority.ci[field]='forged';const {ci_envelope_sha256,...unsigned}=body;body.ci_envelope_sha256=stepSha256(unsigned);attachCiArchive(f,body);
 const input=artifactInputs(f);await assert.rejects(readCiAdmissionBaseline(input.options,input.deps),/CI_ADMISSION_ENVELOPE_IDENTITY/);
});
