import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { releaseEvidenceDatabase } from '../fixtures/release-evidence-db.js';
const holder=vi.hoisted(()=>({pool:null}));
vi.mock('../../db.js',()=>({default:{query:(...a)=>holder.pool.query(...a),connect:(...a)=>holder.pool.connect(...a)}}));
import router from '../../routes/spans.js';
const releases=await import('../../lib/release-index.js').catch(()=>({}));
const runs=await import('../../lib/run-definition-binding.js').catch(()=>({}));
let f,app,bindings,release;
beforeEach(async()=>{
  expect(runs.bindRunDefinition).toBeTypeOf('function');
  f=await releaseEvidenceDatabase();holder.pool=f.db;
  for(const file of ['495_vs_model_spans.sql','513_span_occurrences.sql','515_span_definition_provenance.sql'])await f.db.query(readFileSync(new URL(`../../../migrations/${file}`,import.meta.url),'utf8'));
  release=(await releases.createRelease(f.db,f.releaseInput)).release;
  const observation=(await releases.recordReleaseObservation(f.db,release.id,f.observationInput,{trustedCollector:'fixture-collector'})).observation;
  bindings=[];
  for(const [i,w] of f.workflows.entries())bindings.push((await runs.bindRunDefinition(f.db,`fixed-${i}`,f.runInput(release,observation,w))).binding);
  app=express();app.use(express.json());app.use('/api/brain',router);
});
afterEach(async()=>{await f?.close();f=null;});
function span(index=0,extra={}){
  const w=f.workflows[index],ref=w.payload.activities[0],b=bindings[index];
  return {run_id:b.run_id,workflow_id:w.workflow_id,activity_id:ref.activity_id,started_at:'2026-10-02T10:00:00Z',ended_at:'2026-10-02T10:00:01Z',executor_kind:'code',outcome:'pass',occurrence_key:'position-1',identity_protocol:2,run_binding_id:b.id,reference_id:ref.reference_id,workflow_definition_version_id:w.id,activity_definition_version_id:ref.activity_version_id,attempt_key:b.attempt_key,...extra};
}
const post=body=>request(app).post('/api/brain/spans').send(body);
const count=async()=>Number((await f.db.query('SELECT count(*) n FROM spans')).rows[0].n);
it('两个Workflow使用共享Activity，各自固定身份并可读回，外部运行不造task_run',async()=>{
  const r=await post([span(0),span(1)]);expect(r.status,r.body).toBe(200);expect(r.body.inserted).toBe(2);
  for(let i=0;i<2;i++){const rows=(await request(app).get('/api/brain/spans').query({run_id:bindings[i].run_id})).body.spans;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({identity_protocol:2,run_binding_id:bindings[i].id,reference_id:span(i).reference_id});}
  expect(Number((await f.db.query('SELECT count(*) n FROM task_runs')).rows[0].n)).toBe(0);
});
it.each(['workflow_id','reference_id','activity_definition_version_id','step_id','enabler_id','run_binding_id'])('错误%s令整批零写入',async field=>{
  const r=await post([span(0,{occurrence_key:'a-valid'}),span(0,{[field]:randomUUID(),occurrence_key:'z-bad'})]);expect(r.status,r.body).toBe(422);expect(r.body.code).toMatch(/^SPAN_/);expect(await count()).toBe(0);
});
it('丢确认后重传一条，真实再执行第二条；异内容409保原事实',async()=>{
  expect((await post(span())).body.inserted).toBe(1);expect((await post(span())).body.skipped).toBe(1);
  expect((await post(span(0,{occurrence_key:'position-2'}))).body.inserted).toBe(1);
  expect((await post(span(0,{outcome:'fail'}))).status).toBe(409);expect(await count()).toBe(2);
});
it('当前引用与步骤变化不改历史归属，Enabler按冻结caller验证',async()=>{
  const w=f.workflows[0],ref=w.payload.activities.find(r=>r.activity_id===release.payload.allowed_enabler_calls[0].activity_id);
  await f.db.query('UPDATE workflow_activity_refs SET active=false WHERE workflow_id=$1',[w.workflow_id]);
  await f.db.query('UPDATE enablers SET active=false WHERE id=$1',[f.enabler]);
  const body=span(0,{reference_id:ref.reference_id,activity_id:ref.activity_id,activity_definition_version_id:ref.activity_version_id,enabler_id:f.enabler,enabler_call_id:f.call});
  expect((await post(body)).status).toBe(200);
  expect((await post({...body,occurrence_key:'bad-caller',step_id:randomUUID()})).status).toBe(422);expect(await count()).toBe(1);
});
it('旧未绑定运行仍幂等，已绑定运行禁止降级v1，数据库同样拒绝',async()=>{
  const old={run_id:'historical-unbound',activity_id:span().activity_id,started_at:'2026-10-02T10:00:00Z',executor_kind:'code',occurrence_key:'legacy-1'};
  expect((await post(old)).body.inserted).toBe(1);expect((await post(old)).body.skipped).toBe(1);
  const bad=await post({...old,run_id:bindings[0].run_id});expect(bad.status,bad.body).toBe(422);
  await expect(f.db.query("INSERT INTO spans(run_id,activity_id,started_at,executor_kind) VALUES($1,$2,now(),'code')",[bindings[0].run_id,old.activity_id])).rejects.toThrow();expect(await count()).toBe(1);
});
it('反序批次并发只保存一组，返回顺序仍与输入一致',async()=>{
  const a=span(0,{occurrence_key:'a'}),b=span(0,{occurrence_key:'b'});
  const r=await Promise.all([post([b,a]),post([a,b])]);expect(r.map(x=>x.status)).toEqual([200,200]);expect(r.map(x=>x.body.inserted).sort()).toEqual([0,2]);expect(await count()).toBe(2);
});
