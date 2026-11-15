import {afterEach,expect,it,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createWorkflowFoundationRouter} from '../workflow-foundation.js';
import {TASK_MUTATION_RATE_LIMIT_OPTIONS} from '../task-mutation-rate-limit.js';

afterEach(()=>vi.unstubAllEnvs());
it('底座鉴权失败同样消耗现行任务入口配额，超限前后均不访问数据库',async()=>{
 vi.stubEnv('CECELIA_INTERNAL_TOKEN','isolated-foundation-rate-limit');
 const pool={query:vi.fn()},app=express();
 app.use('/foundation',createWorkflowFoundationRouter({pool}));
 for(let i=0;i<TASK_MUTATION_RATE_LIMIT_OPTIONS.limit;i++){
  expect((await request(app).post('/foundation/claim').send({machine_id:'fixture'})).status).toBe(401);
 }
 const over=await request(app).post('/foundation/claim').send({machine_id:'fixture'});
 expect(over.status).toBe(429);expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
 expect(pool.query).not.toHaveBeenCalled();
},15000);
