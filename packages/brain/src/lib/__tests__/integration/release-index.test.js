import { createHash } from 'node:crypto';
import { afterEach,beforeEach,expect,it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { releaseEvidenceDatabase,RELEASE_HEAD } from '../../../__tests__/fixtures/release-evidence-db.js';
import * as service from '../../release-index.js';
import * as routes from '../../../routes/releases.js';
let fixture,app;
beforeEach(async()=>{
  expect(service.createRelease,'发布服务必须存在').toBeTypeOf('function');
  expect(routes.createReleasesRouter,'发布HTTP入口必须存在').toBeTypeOf('function');
  fixture=await releaseEvidenceDatabase();app=express();app.use(express.json());app.use('/releases',routes.createReleasesRouter({pool:fixture.db,trustedCollectors:['fixture-collector']}));
});
afterEach(async()=>{await fixture?.close();fixture=null;});
const post=()=>request(app).post('/releases').send(fixture.releaseInput);
const observe=(id,extra={})=>request(app).post(`/releases/${id}/observations`).send({...fixture.observationInput,...extra});
it('真实HTTP发布固定两Workflow/AV/Enabler来源，同内容幂等异内容409，数据库拒UPDATE/DELETE',async()=>{
  let r=await post();expect(r.status,r.body).toBe(201);const release=r.body.release;
  expect(release.payload.workflows).toHaveLength(2);expect(release.payload.allowed_enabler_calls[0]).toMatchObject({id:fixture.call,source_status:'verified'});
  r=await post();expect(r.status,r.body).toBe(200);expect(r.body.release.id).toBe(release.id);
  r=await request(app).post('/releases').send({...fixture.releaseInput,target:'other'});expect(r.status).toBe(409);
  for(const sql of ['UPDATE release_versions SET target=target WHERE id=$1','DELETE FROM release_versions WHERE id=$1'])await expect(fixture.db.query(sql,[release.id])).rejects.toMatchObject({code:'P0001'});
});
it('错误SHA/缺组件/无实测证据不能deployed，失败后保旧成功并显示当前漂移',async()=>{
  const release=(await post()).body.release;
  let r=await observe(release.id);expect(r.status,r.body).toBe(201);const good=r.body.observation;
  let gate=(await request(app).get(`/releases/${release.id}/gate`)).body;expect(gate).toMatchObject({deployed:true,ever_deployed:true});
  const wrong=fixture.observationInput.components.map(c=>({...c,revision:'c'.repeat(40)}));
  r=await observe(release.id,{event_key:'observed-2',components:wrong,observed_at:new Date(Date.now()+1000).toISOString()});expect(r.status).toBe(201);
  gate=(await request(app).get(`/releases/${release.id}/gate`)).body;expect(gate).toMatchObject({deployed:false,ever_deployed:true,last_verified_observation_id:good.id,current_status:'drift'});
  r=await observe(release.id,{event_key:'observed-3',components:[],observed_at:new Date(Date.now()+2000).toISOString()});expect(r.status).toBe(201);expect((await request(app).get(`/releases/${release.id}/gate`)).body.deployed).toBe(false);
  r=await observe(release.id,{event_key:'asserted-success',deployed:true});expect(r.status).toBe(422);
  expect((await fixture.db.query('SELECT count(*)::int n FROM release_observations')).rows[0].n).toBe(3);
});
it('观测重传幂等，改body冲突；非受信collector拒绝且零写',async()=>{
  const release=(await post()).body.release;
  let r=await observe(release.id);expect(r.status,r.body).toBe(201);const first=r.body.observation;
  r=await observe(release.id);expect(r.status).toBe(200);expect(r.body.observation.id).toBe(first.id);
  r=await observe(release.id,{evidence_ref:'fixture:changed'});expect(r.status).toBe(409);
  r=await observe(release.id,{event_key:'untrusted',collector:'unknown'});expect(r.status).toBe(403);
  expect((await fixture.db.query('SELECT count(*)::int n FROM release_observations')).rows[0].n).toBe(1);
  await expect(fixture.db.query('DELETE FROM release_observations WHERE id=$1',[first.id])).rejects.toMatchObject({code:'P0001'});
});
it('发布时服务端逐项核定义/组件/CI，缺Enabler固定来源只可unknown',async()=>{
  let r=await request(app).post('/releases').send({...fixture.releaseInput,components:fixture.releaseInput.components.map(c=>({...c,revision:'c'.repeat(40)}))});expect(r.status).toBe(422);
  expect((await fixture.db.query('SELECT count(*)::int n FROM release_versions')).rows[0].n).toBe(0);
  await fixture.db.query("UPDATE enablers SET impl_ref='legacy/path.js' WHERE id=$1",[fixture.enabler]);
  r=await post();expect(r.status,r.body).toBe(201);expect(r.body.release.payload.verification.status).toBe('unknown');
  await observe(r.body.release.id);expect((await request(app).get(`/releases/${r.body.release.id}/gate`)).body.deployed).toBe(false);
  expect(r.body.release.payload.components[0].revision).toBe(RELEASE_HEAD);
});
it('CI PASS标签不足，receipt与report摘要不符或真实测试失败只能unknown',async()=>{
  const input=structuredClone(fixture.releaseInput);input.ci_evidence[0].receipt.report_sha256='0'.repeat(64);
  let r=await request(app).post('/releases').send(input);expect(r.status,r.body).toBe(201);expect(r.body.release.payload.verification.ci_status).toBe('unknown');
  const input2=structuredClone(fixture.releaseInput);input2.release_key='failed-ci';input2.ci_evidence[0].receipt.assertions[0].exit_code=1;
  r=await request(app).post('/releases').send(input2);expect(r.body.release.payload.verification.ci_status).toBe('unknown');
});
it('manifest摘要可由HTTP下载JSON精确重算，额外未登记Code不能声称已逐项核验',async()=>{
  const r=await post();const release=r.body.release;
  expect(service.evidenceHash({environment:release.environment,target:release.target,payload:release.payload})).toBe(release.manifest_sha256);
  const input=structuredClone(fixture.releaseInput);input.release_key='unbound-code';input.components.push({...input.components[1],path:'src/not-in-contract.js'});
  expect((await request(app).post('/releases').send(input)).status).toBe(422);
});
it('回滚回读保留两release历史，仅实际组件相等的版本成为当前deployed',async()=>{
  const first=(await post()).body.release;await observe(first.id);
  const second=(await request(app).post('/releases').send({...fixture.releaseInput,release_key:'next-release',target:'other-host'})).body.release;
  await observe(second.id,{environment:second.environment,target:second.target,event_key:'other-target',components:[]});
  expect((await request(app).get(`/releases/${first.id}/gate`)).body.deployed).toBe(true);
  await observe(first.id,{event_key:'drift-other',components:[],observed_at:new Date(Date.now()+1000).toISOString()});
  expect((await request(app).get(`/releases/${first.id}/gate`)).body).toMatchObject({deployed:false,ever_deployed:true});
  await observe(first.id,{event_key:'rollback',attempt_key:'rollback-1',observed_at:new Date(Date.now()+2000).toISOString()});
  expect((await request(app).get(`/releases/${first.id}/gate`)).body).toMatchObject({deployed:true,ever_deployed:true});
  expect((await fixture.db.query('SELECT count(*)::int n FROM release_observations')).rows[0].n).toBe(4);
});
it('最新发布尝试实测到错误目标时不沿用较早成功',async()=>{
  const release=(await post()).body.release;await observe(release.id);
  await observe(release.id,{event_key:'wrong-target',target:'different-host',observed_at:new Date(Date.now()+1000).toISOString()});
  const gate=(await request(app).get(`/releases/${release.id}/gate`)).body;
  expect(gate).toMatchObject({deployed:false,ever_deployed:true,current_status:'drift'});
});
it('CI证据结构缺失或assertion空项只降级unknown，不返回500或伪green',async()=>{
  for(const [index,mutate] of [
    input=>delete input.ci_evidence[0].receipt.source,
    input=>input.ci_evidence[0].receipt.assertions=[null],
  ].entries()){
    const input=structuredClone(fixture.releaseInput);input.release_key=`malformed-ci-${index}`;mutate(input);
    const response=await request(app).post('/releases').send(input);
    expect(response.status,JSON.stringify(response.body)).toBe(201);expect(response.body.release.payload.verification.ci_status).toBe('unknown');
  }
});
it('历史固定AV缺规范Step UUID时step coverage明确unknown，不以Activity冒充完整验收',async()=>{
  const original=fixture.activities[0],payload=structuredClone(original.payload);payload.steps[0].step_id=null;
  const digest=service.evidenceHash({source:{repo:original.source_repo,path:original.source_path,commit:original.source_commit},payload});
  const replacement=(await fixture.db.query('INSERT INTO activity_definition_versions(activity_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[original.activity_id,payload,original.contract_sha256,digest,original.source_repo,original.source_path,original.source_commit])).rows[0];
  const input=structuredClone(fixture.releaseInput);
  for(const workflow of fixture.workflows){
    const wp=structuredClone(workflow.payload);let changed=false;
    for(const ref of wp.activities)if(ref.activity_version_id===original.id){ref.activity_version_id=replacement.id;changed=true;}
    if(!changed)continue;
    const sha=service.evidenceHash({source:{repo:workflow.source_repo,path:workflow.source_path,commit:workflow.source_commit},payload:wp});
    const row=(await fixture.db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[workflow.workflow_id,wp,workflow.contract_sha256,sha,workflow.source_repo,workflow.source_path,workflow.source_commit])).rows[0];
    input.workflows=input.workflows.map(w=>w.workflow_definition_version_id===workflow.id?{workflow_definition_version_id:row.id,payload_sha256:sha}:w);
  }
  const response=await request(app).post('/releases').send(input);expect(response.status,JSON.stringify(response.body)).toBe(201);
  expect(response.body.release.payload.verification).toMatchObject({step_coverage_status:'unknown',definition_status:'unknown',status:'unknown'});
  expect(response.body.release.payload.verification.gaps).toContainEqual(expect.objectContaining({code:'step_identity_missing',activity_definition_version_id:replacement.id}));
});

it('删去共享消费者断言覆盖后即使report与receipt重新摘要自洽也不能green',async()=>{
  const input=structuredClone(fixture.releaseInput),ci=input.ci_evidence[0],assertion=ci.report.required_assertions[0];
  const omitted=assertion.source_bindings[0].capability_id;
  assertion.source_bindings=assertion.source_bindings.filter(b=>b.capability_id!==omitted);
  assertion.capability_ids=assertion.capability_ids.filter(id=>id!==omitted);
  ci.receipt.assertions[0].source_bindings=assertion.source_bindings;
  ci.receipt.report_sha256=createHash('sha256').update(JSON.stringify(ci.report)).digest('hex');
  const response=await request(app).post('/releases').send(input);expect(response.status).toBe(201);
  expect(response.body.release.payload.verification.ci_status).toBe('unknown');
  await observe(response.body.release.id);expect((await service.getReleaseGate(fixture.db,response.body.release.id)).deployed).toBe(false);
});
it.each(['file_coverage','graph_snapshot'])('报告缺少%s固定证据即使摘要匹配也不能green',async field=>{
  const input=structuredClone(fixture.releaseInput),ci=input.ci_evidence[0];delete ci.report.head[field];
  ci.receipt.report_sha256=createHash('sha256').update(JSON.stringify(ci.report)).digest('hex');
  const response=await request(app).post('/releases').send(input);expect(response.status).toBe(201);
  expect(response.body.release.payload.verification.ci_status).toBe('unknown');
});
it('PR admission_only收据即使SHA及中央版本完全匹配也不能用于发布',async()=>{
  const input=structuredClone(fixture.releaseInput);input.ci_evidence[0].receipt.purpose='admission_only';
  const response=await request(app).post('/releases').send(input);expect(response.status).toBe(201);
  expect(response.body.release.payload.verification.ci_status).toBe('unknown');
  expect(response.body.release.payload.verification.gaps).toContainEqual(expect.objectContaining({code:'ci_admission_only',index:0}));
  await observe(response.body.release.id);expect((await service.getReleaseGate(fixture.db,response.body.release.id)).deployed).toBe(false);
});

it('治理receipt必须逐项对应报告的受信检查脚本，不能用同数量任意PASS替换',async()=>{
 const input=structuredClone(fixture.releaseInput),ci=input.ci_evidence[0];
 ci.report.governance_evidence={files:[{path:'DEFINITION.md'}],policy_sha256:'a'.repeat(64),checks:[{id:'facts',path:'scripts/facts-check.mjs',script_sha256:'a'.repeat(64),exit_code:0}]};
 ci.receipt.governance_evidence=structuredClone(ci.report.governance_evidence);
 ci.receipt.governance_evidence.checks[0]={id:'forged',path:'scripts/forged.js',script_sha256:'b'.repeat(64),exit_code:0};
 ci.receipt.report_sha256=createHash('sha256').update(JSON.stringify(ci.report)).digest('hex');
 const response=await request(app).post('/releases').send(input);expect(response.status).toBe(201);
 expect(response.body.release.payload.verification.ci_status).toBe('unknown');
});
