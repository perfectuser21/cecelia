import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCommonRunnerRouter } from '../common-runner.js';

describe('common-runner routes', () => {
  it('uses the internal authentication boundary and forwards a registered task request', async () => {
    const dispatch = vi.fn(async () => ({ authenticated: true, receipt: { status: 'running' } }));
    const app = express(); app.use(express.json());
    app.use('/api/brain/common-runner', createCommonRunnerRouter({ dispatcher: { dispatch }, authenticate: (_req, _res, next) => next() }));
    const body = { task_id: '10000000-0000-4000-8000-000000000001', profile: 'demo', mode: 'exploration', input: {} };
    const response = await request(app).post('/api/brain/common-runner/20000000-0000-4000-8000-000000000001/start').send(body);
    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalledWith('start', '20000000-0000-4000-8000-000000000001', body);
  });
  it('does not disclose internal error text', async () => {
    const app = express(); app.use(express.json());
    app.use(createCommonRunnerRouter({ dispatcher: { dispatch: async () => { throw Error('postgres://private-details'); } }, authenticate: (_req, _res, next) => next() }));
    const response = await request(app).post('/run/start').send({});
    expect(response.status).toBe(503); expect(response.text).not.toContain('private-details');
  });
  it('requires internal auth by default', async () => {
    const app = express(); app.use(express.json()); app.use(createCommonRunnerRouter({ dispatcher: { dispatch: vi.fn() } }));
    const previous = process.env.CECELIA_INTERNAL_TOKEN; process.env.CECELIA_INTERNAL_TOKEN = 'test-only-internal-boundary';
    try { expect((await request(app).post('/run/start').send({})).status).toBe(401); }
    finally { if (previous === undefined) delete process.env.CECELIA_INTERNAL_TOKEN; else process.env.CECELIA_INTERNAL_TOKEN = previous; }
  });
});

it('启用DBOS时公共start进入持久协调器，返回202而不直接启动第二个Runner',async()=>{
 const dispatch=vi.fn(),durableStart=vi.fn(async()=>({workflow_id:'common-runner:original'}));
 const app=express();app.use(express.json());app.use(createCommonRunnerRouter({dispatcher:{dispatch},durableStart,env:{DBOS_DURABLE_ENABLED:'true'},authenticate:(_q,_s,n)=>n()}));
 const body={task_id:'10000000-0000-4000-8000-000000000001',profile:'demo',mode:'exploration',input:{}};
 const response=await request(app).post('/20000000-0000-4000-8000-000000000001/start').send(body);
 expect(response.status).toBe(202);expect(response.body.durable_workflow_id).toBe('common-runner:original');
 expect(durableStart.mock.calls[0][0]).toMatchObject({run_id:'20000000-0000-4000-8000-000000000001',body});expect(dispatch).not.toHaveBeenCalled();
});
it('DBOS不可用时保留失败，禁止降级裸start',async()=>{
 const dispatch=vi.fn(),app=express();app.use(express.json());app.use(createCommonRunnerRouter({dispatcher:{dispatch},env:{DBOS_DURABLE_ENABLED:'true'},durableStart:async()=>{throw Object.assign(Error('common_runner_durable_unavailable'),{status:503});},authenticate:(_q,_s,n)=>n()}));
 expect((await request(app).post('/run/start').send({})).status).toBe(503);expect(dispatch).not.toHaveBeenCalled();
});
