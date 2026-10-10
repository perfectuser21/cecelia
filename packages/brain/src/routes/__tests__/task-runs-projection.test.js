import {describe,it,expect,vi,afterEach} from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../db.js',()=>({default:{query:vi.fn()}}));
vi.mock('../../projection/task-runs-config.js',()=>({configureTaskRunsProjection:vi.fn(async()=>({enabled:true,status:'active'}))}));
const {default:router}=await import('../projections.js');
const app=express();app.use(express.json());app.use('/api/brain',router);
afterEach(()=>vi.unstubAllEnvs());
describe('Runs投影正式API鉴权',()=>{
 it('未带token零配置，带token才接受显式请求',async()=>{
  vi.stubEnv('CECELIA_INTERNAL_TOKEN','fixture-token');
  const {configureTaskRunsProjection}=await import('../../projection/task-runs-config.js');configureTaskRunsProjection.mockClear();
  expect((await request(app).post('/api/brain/projections/notion/task-runs/bootstrap').send({enabled:true})).status).toBe(401);expect(configureTaskRunsProjection).not.toHaveBeenCalled();
  expect((await request(app).post('/api/brain/projections/notion/task-runs/bootstrap').set('X-Internal-Token','fixture-token').send({enabled:true,actor:'operator'})).status).toBe(200);expect(configureTaskRunsProjection).toHaveBeenCalledOnce();
 });
 it('内部错误不回显token或私人资料',async()=>{
  vi.stubEnv('CECELIA_INTERNAL_TOKEN','fixture-token');const {configureTaskRunsProjection}=await import('../../projection/task-runs-config.js');configureTaskRunsProjection.mockRejectedValueOnce(Error('private-secret'));
  const r=await request(app).post('/api/brain/projections/notion/task-runs/configure').set('X-Internal-Token','fixture-token').send({enabled:true});expect(r.status).toBe(400);expect(JSON.stringify(r.body)).not.toContain('private-secret');
 });
});
