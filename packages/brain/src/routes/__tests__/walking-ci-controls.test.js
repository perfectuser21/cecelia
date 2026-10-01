import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const pointers = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({ getPgCheckpointer: pointers }));
vi.mock('../../workflows/walking-skeleton-1node.graph.js', () => ({
  getCompiledWalkingSkeleton: vi.fn(async () => ({ invoke })),
}));
vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
import router from '../walking-skeleton.js';
const app = () => express().use(express.json()).use('/api/brain', router);
function ci() {
  for (const [key, value] of Object.entries({ CI: 'true', WALKING_CI_OWNER: '1', NODE_ENV: 'test',
    DB_NAME: 'cecelia_test', DB_HOST: 'localhost', DB_PORT: '5432', BRAIN_PORT: '5221',
    DATABASE_URL: 'postgresql://localhost:5432/cecelia_test' })) vi.stubEnv(key, value);
}
beforeEach(() => { vi.unstubAllEnvs(); pointers.mockClear(); invoke.mockClear(); });
afterEach(() => vi.unstubAllEnvs());
describe('Walking restart control permission before checkpointer or Docker', () => {
  it('production restart control is rejected before checkpoint setup', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await request(app()).post('/api/brain/walking-skeleton-1node/trigger').send({ wait_for_restart: true }).expect(403);
    expect(pointers).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  });
  it.each(['yes', false, 1, {}])('unknown restart mode %j is rejected before checkpoint setup', async mode => {
    ci();
    await request(app()).post('/api/brain/walking-skeleton-1node/trigger').send({ wait_for_restart: mode }).expect(400);
    expect(pointers).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  });
  it('production instance token is not exposed and no checkpoint is queried', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await request(app()).get('/api/brain/walking-skeleton-1node/instance').expect(403);
    expect(pointers).not.toHaveBeenCalled();
  });
  it('safe CI instance uses an actual random UUID and assigns it to restart graph state', async () => {
    ci();
    const res = await request(app()).get('/api/brain/walking-skeleton-1node/instance').expect(200);
    expect(res.body.instance_id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    await request(app()).post('/api/brain/walking-skeleton-1node/trigger').send({ wait_for_restart: true }).expect(200);
    expect(invoke.mock.calls[0][0].restartInstanceId).toBe(res.body.instance_id);
  });
  it('remote or conflicting CI database fails before instance or checkpoint access', async () => {
    ci(); vi.stubEnv('DATABASE_URL', 'postgresql://remote/cecelia_test');
    await request(app()).get('/api/brain/walking-skeleton-1node/instance').expect(403);
    await request(app()).post('/api/brain/walking-skeleton-1node/trigger').send({ wait_for_restart: true }).expect(403);
    expect(pointers).not.toHaveBeenCalled();
  });
});
