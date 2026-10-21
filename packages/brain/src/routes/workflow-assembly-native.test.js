import {it,expect,vi,afterEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createNativeAssemblyRouter} from './workflow-assembly-native.js';
const original=process.env.CECELIA_INTERNAL_TOKEN;
afterEach(()=>{if(original===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=original;});
it('真实HTTP内部token必验；x-tenant-id不授全局扫描权，任意预算/runner输入零数据库写',async()=>{
  process.env.CECELIA_INTERNAL_TOKEN='fixture-internal-only';
  const pool={query:vi.fn(),connect:vi.fn()},app=express();app.use(express.json());app.use('/maintenance',createNativeAssemblyRouter({pool}));
  expect((await request(app).post('/maintenance/runs').send({request_key:'x'})).status).toBe(401);
  expect((await request(app).post('/maintenance/runs').set('x-internal-token','fixture-internal-only').set('x-tenant-id','alpha').send({request_key:'x'})).status).toBe(422);
  expect((await request(app).post('/maintenance/runs').set('x-internal-token','fixture-internal-only').send({request_key:'x',budgetMs:99999})).status).toBe(422);
  expect(pool.query).not.toHaveBeenCalled();expect(pool.connect).not.toHaveBeenCalled();
});
