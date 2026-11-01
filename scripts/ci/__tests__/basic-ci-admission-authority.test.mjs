import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ciAuthorityProof} from '../ci-admission-authority.mjs';
import {authorityFixture} from './fixtures/ci-admission-authority.mjs';
const prefix='repos/perfectuser21/cecelia';
test('真实first-parent固定源码与较晚控制SHA分域，API run/job/check同链给opaque能力',async t=>{
 const f=authorityFixture(t),cap=await f.run(),proof=ciAuthorityProof(cap);
 assert.equal(proof.source_revision,f.source);assert.equal(proof.control_revision,f.control);
 assert.equal(proof.ci.check_run_id,34);assert.equal(proof.publisher.check_run_id,44);
 assert.equal(JSON.stringify(cap),'{}');assert.throws(()=>ciAuthorityProof({...cap}),/CI_ADMISSION_AUTHORITY_REQUIRED/);
});
for(const kind of ['event','branch','sha','app','check-link','job-link','workflow','suite','cancel','skip','pagination','duplicate','attempt','unprotected','publisher-event','publisher-app','artifact-time'])test('不一致的真实来源链拒绝：'+kind,async t=>{
 const f=authorityFixture(t),run=f.data.get(`${prefix}/actions/runs/11`),jobs=f.data.get(`${prefix}/actions/runs/11/attempts/1/jobs?per_page=100`),check=f.data.get(`${prefix}/check-runs/34`);
 if(kind==='event')run.event='pull_request';if(kind==='branch')run.head_branch='feature';if(kind==='sha')run.head_sha=f.control;
 if(kind==='app')check.app.id=7;if(kind==='check-link')check.details_url=check.details_url.replace('/job/33','/job/43');
 if(kind==='job-link')jobs.jobs[0].check_run_url=`https://api.github.com/${prefix}/check-runs/44`;
 if(kind==='workflow')run.workflow_id=200;if(kind==='suite')check.check_suite.id=901;
 if(kind==='cancel')run.conclusion='cancelled';if(kind==='skip')check.conclusion='skipped';
 if(kind==='pagination')jobs.total_count=2;if(kind==='duplicate')jobs.jobs.push({...jobs.jobs[0],id:35}),jobs.total_count=2;
 if(kind==='attempt')run.run_attempt=2;if(kind==='unprotected')f.data.get(`${prefix}/branches/main`).protected=false;
 if(kind==='publisher-event')f.data.get(`${prefix}/actions/runs/22`).event='pull_request';
 if(kind==='publisher-app')f.data.get(`${prefix}/check-runs/44`).app.id=7;
 if(kind==='artifact-time')f.options.publisher.artifactCreatedAt='2026-11-01T00:04:00Z';
 await assert.rejects(f.run(),/CI_ADMISSION_/);
});
test('第二父即使已被main合并也不是发布控制权限',async t=>{
 const f=authorityFixture(t);f.git('checkout','-qb','side',f.source);writeFileSync(join(f.root,'side'),'x');f.git('add','side');f.git('commit','-qm','side');const side=f.git('rev-parse','HEAD');
 f.git('checkout','-q','main');f.git('merge','--no-ff','-qm','merge','side');const main=f.git('rev-parse','HEAD');
 f.data.get(`${prefix}/branches/main`).commit.sha=main;f.options.controlRevision=side;
 f.data.get(`${prefix}/actions/runs/22`).head_sha=side;f.data.get(`${prefix}/check-runs/44`).head_sha=side;
 f.data.get(`${prefix}/actions/runs/22/attempts/1/jobs?per_page=100`).jobs[0].head_sha=side;
 await assert.rejects(f.run(),/CI_ADMISSION_MAIN_CHAIN/);
});
test('publisher不能覆盖固定事件/路径，也不能跨repository id',async t=>{
 const f=authorityFixture(t);f.options.publisher.event='push';
 await assert.rejects(f.run(),/CI_ADMISSION_/);
 delete f.options.publisher.event;
 f.data.get(`${prefix}/actions/runs/22`).repository={id:100,full_name:'perfectuser21/cecelia'};
 f.data.get(`${prefix}/actions/runs/22`).head_repository={id:100,full_name:'perfectuser21/cecelia'};
 await assert.rejects(f.run(),/CI_ADMISSION_/);
});
test('不能用自报publisher字段把普通CI run升级成artifact发布器',async t=>{
 const f=authorityFixture(t);f.options.controlRevision=f.source;
 f.options.publisher={runId:11,attempt:1,path:'.github/workflows/ci.yml',event:'push',name:'源码保底通过'};
 await assert.rejects(f.run(),/CI_ADMISSION_/);
});
