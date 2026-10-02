import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { createCapabilityRegressionsRouter } from '../../capability-regressions.js';
let f,app;
beforeEach(async()=>{f=await releaseEvidenceDatabase();app=express();app.use(express.json());app.use('/regressions',createCapabilityRegressionsRouter({pool:f.db}));});
afterEach(async()=>{vi.unstubAllEnvs();await f?.close();});
it('内部鉴权及真实PG回读，登记不接受状态置绿或虚构Step身份',async()=>{
  vi.stubEnv('CECELIA_INTERNAL_TOKEN','fixture-registration-token');
  const activity=f.activities.find(a=>a.payload.implementation_bindings.some(b=>b.kind==='code'));
  const body={capability_id:f.capabilities[0],activity_id:activity.activity_id,assertion_ref:'scripts/smoke/regression.sh'};
  expect((await request(app).post('/regressions').send(body)).status).toBe(401);
  const response=await request(app).post('/regressions').set('X-Internal-Token','fixture-registration-token').send(body);
  expect(response.status).toBe(201);
  const row=(await f.db.query('SELECT * FROM journey_step_links WHERE id=$1',[response.body.registration.id])).rows[0];
  expect(row).toMatchObject({journey_id:body.capability_id,step_id:body.activity_id,assertion_ref:body.assertion_ref,cell_status:'gray'});
  expect((await request(app).post('/regressions').set('X-Internal-Token','fixture-registration-token').send({...body,cell_status:'green'})).status).toBe(400);
  expect((await request(app).post('/regressions').set('X-Internal-Token','fixture-registration-token').send({...body,step_id:'not-uuid'})).status).toBe(400);
});

it('真实HTTP回归登记写入口超出每分钟60次返回429且零新增记录',async()=>{
 const before=(await f.db.query('SELECT count(*)::int n FROM journey_step_links')).rows[0].n;
 for(let i=0;i<60;i++)expect((await request(app).post('/regressions').send({})).status).toBe(400);
 expect((await request(app).post('/regressions').send({})).status).toBe(429);
 expect((await f.db.query('SELECT count(*)::int n FROM journey_step_links')).rows[0].n).toBe(before);
});
