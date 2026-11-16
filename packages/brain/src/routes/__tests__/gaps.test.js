import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), open: vi.fn(), transition: vi.fn(), byTask: vi.fn(), byId: vi.fn(), events: vi.fn(), list: vi.fn(), repair: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../../impact-contract/gap-store.js', () => ({ openGapForDrift: mocks.open, transitionGapStatus: mocks.transition, getGapsByTask: mocks.byTask, getGapById: mocks.byId, getGapEvents: mocks.events, listGapsByStatus: mocks.list, assignRepairTaskWithDependency: mocks.repair }));
import pool from '../../db.js';
import router from '../gaps.js';
function app() { const a = express(); a.use(express.json()); a.use('/gaps', router); return a; }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'owned-gap-token'); });
afterEach(() => vi.unstubAllEnvs());
describe('gaps HTTP authorization and repair task', () => {
  it.each([['post', '/gaps'], ['post', '/gaps/gap-1/repair-task'], ['patch', '/gaps/gap-1/status']])('%s %s 匿名不能触发store或SQL', async (method, path) => {
    const r = await request(app())[method](path).send({ source_task_id: 'source', impact_node_id: 'node', repair_task_id: 'repair', status: 'resolved' });
    expect(r.status).toBe(401); expect(r.body.error.code).toBe('UNAUTHORIZED');
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  });
  it('repair-task透传gap和repair ID，返回真实store结果', async () => {
    mocks.repair.mockResolvedValue({ gap: { id: 'gap-1' }, dependency_created: true });
    const r = await request(app()).post('/gaps/gap-1/repair-task').set('X-Internal-Token', 'owned-gap-token').send({ repair_task_id: 'repair-1' });
    expect(r.status).toBe(200); expect(r.body).toEqual({ gap: { id: 'gap-1' }, dependency_created: true });
    expect(mocks.repair).toHaveBeenCalledWith(pool, 'gap-1', 'repair-1');
  });
  it('repair-task缺少ID返回400零store', async () => {
    const r = await request(app()).post('/gaps/gap-1/repair-task').set('X-Internal-Token', 'owned-gap-token').send({});
    expect(r.status).toBe(400); expect(r.body.error).toBe('invalid_request'); expect(mocks.repair).not.toHaveBeenCalled();
  });
  it('repair-task不存在映射404', async () => {
    mocks.repair.mockRejectedValue(Object.assign(new Error('missing gap'), { code: 'gap_not_found' }));
    const r = await request(app()).post('/gaps/gap-1/repair-task').set('X-Internal-Token', 'owned-gap-token').send({ repair_task_id: 'repair-1' });
    expect(r.status).toBe(404); expect(r.body.error).toBe('not_found');
  });
});
