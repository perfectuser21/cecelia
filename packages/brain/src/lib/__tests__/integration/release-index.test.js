import { afterEach,beforeEach,expect,it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { releaseEvidenceDatabase,RELEASE_HEAD } from '../../../__tests__/fixtures/release-evidence-db.js';
const service=await import('../../release-index.js').catch(()=>({}));
const routes=await import('../../../routes/releases.js').catch(()=>({}));
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
