import express from 'express';
import request from 'supertest';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {fixture,taskId} from './recovery-rebase.fixture.js';
const db=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn()}));
vi.mock('../../db.js',()=>({default:db}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe('退役Kernel恢复目标不能重新获取执行权',()=>{
 it.each([{execution_target:{machine:'xian-mac-m4',provider:'codex',account:'team2'}},{execution_target:{machine:'invalid',provider:'codex',account:'team2'}},{expected_profile_hash:'f'.repeat(64)},{}])('请求%j在鉴权后拒绝且旧运行/收据/账号保持原状',async change=>{
  const f=fixture();db.connect.mockImplementation(f.pool.connect);vi.stubEnv('CECELIA_INTERNAL_TOKEN','synthetic-cross-path-token');
  const {default:router}=await import('../../routes/initiatives.js');const app=express();app.use(express.json());app.use('/api/brain/orchestrator',router);
  const response=await request(app).post('/api/brain/orchestrator/relay-runs').set('X-Internal-Token','synthetic-cross-path-token').send({initiative_id:f.input.initiativeId,current_task_id:taskId,phase:'planning',created_source:'explicit_recovery',predecessor_run_id:f.input.predecessorRunId,recovery_rebase:{...f.request,...change}});
  expect(response.status).toBe(410);expect(response.body.error).toBe('kernel_runtime_retired');expect(db.connect).not.toHaveBeenCalled();expect(db.query).not.toHaveBeenCalled();expect(f.calls).toEqual([]);
 });
});
