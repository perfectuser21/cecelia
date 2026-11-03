import {afterEach,describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const {mockPool,mockCreateKernelRun}=vi.hoisted(()=>({mockPool:{query:vi.fn(),connect:vi.fn()},mockCreateKernelRun:vi.fn()}));
vi.mock('../db.js',()=>({default:mockPool}));
vi.mock('../orchestrator/kernel-run-store.js',()=>({createKernelRun:mockCreateKernelRun,loadKernelRunById:vi.fn(),patchLegacyKernelRunByInitiative:vi.fn(),patchKernelRunById:vi.fn()}));
async function buildApp(){const {default:router}=await import('../routes/initiatives.js');const app=express();app.use(express.json());app.use('/api/brain/orchestrator',router);return app;}
const id='11111111-2222-4333-8444-555555555555';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe('canonical新建Kernel run已退役，鉴权仍有效',()=>{
 it('恢复请求无token/错误token 401，合法token也不得恢复旧执行器',async()=>{
  vi.stubEnv('CECELIA_INTERNAL_TOKEN','synthetic-internal-token');const app=await buildApp();const body={initiative_id:id,current_task_id:id,created_source:'explicit_recovery',predecessor_run_id:id,recovery_rebase:{}};
  for(const token of ['','wrong'])expect((await request(app).post('/api/brain/orchestrator/relay-runs').set('X-Internal-Token',token).send(body)).status).toBe(401);
  const response=await request(app).post('/api/brain/orchestrator/relay-runs').set('X-Internal-Token','synthetic-internal-token').send(body);
  expect(response.status).toBe(410);expect(response.body.error).toBe('kernel_runtime_retired');expect(mockCreateKernelRun).not.toHaveBeenCalled();expect(mockPool.connect).not.toHaveBeenCalled();expect(mockPool.query).not.toHaveBeenCalled();
 });
 it('生产未配置鉴权仍503，legacy adapter仍禁止恢复请求',async()=>{
  vi.stubEnv('CECELIA_INTERNAL_TOKEN','');vi.stubEnv('NODE_ENV','production');const app=await buildApp();const body={created_source:'explicit_recovery',recovery_rebase:{}};
  expect((await request(app).post('/api/brain/orchestrator/relay-runs').send(body)).status).toBe(503);
  expect((await request(app).post(`/api/brain/orchestrator/relay-runs/${id}`).send(body)).status).toBe(400);
  expect(mockCreateKernelRun).not.toHaveBeenCalled();
 });
 it.each([{}, {initiative_id:id}, {initiative_id:id,current_task_id:id}, {initiative_id:id,current_task_id:id,created_source:'foreground_handoff'}, {commander_mode:'hybrid'}, {commander_mode:'kernel-only'}])('任何新建输入%j均410且无数据库/控制器副作用',async body=>{
  const app=await buildApp();for(const path of ['/relay-runs',`/relay-runs/${id}`]){
   const response=await request(app).post('/api/brain/orchestrator'+path).send(body);expect(response.status).toBe(410);expect(response.body.error).toBe('kernel_runtime_retired');
  }
  expect(mockCreateKernelRun).not.toHaveBeenCalled();expect(mockPool.connect).not.toHaveBeenCalled();expect(mockPool.query).not.toHaveBeenCalled();
 });
});
