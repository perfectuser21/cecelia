import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerHeadedTakeoverRoute } from '../task-headed-takeover.js';
import { registerTaskPatchRoute } from '../task-task-patch.js';
import { rateLimit } from 'express-rate-limit';

const effects = vi.hoisted(() => ({ query: vi.fn(), terminal: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: effects.query } }));
vi.mock('../../lib/task-terminal.js', async importOriginal => ({
  ...await importOriginal(),
  afterTerminalTransition: effects.terminal,
  isTerminalStatus: status => ['completed', 'failed', 'cancelled'].includes(status),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function appWithJson() { const app = express(); app.use(express.json()); return app; }
function rateLimited(response) {
  expect(response.status).toBe(429);
  expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  expect(response.headers.ratelimit).toMatch(/limit=300/);
  expect(response.headers['ratelimit-policy']).toBe('300;w=60');
  for (const key of Object.keys(response.headers)) expect(key).not.toMatch(/^x-ratelimit-/);
}
async function burst(app, method, paths, body, expectedStatus) {
  for (let i = 0; i < 300; i++) {
    const response = await request(app)[method](paths[i % paths.length]).send(body);
    expect(response.status, `request ${i + 1}`).toBe(expectedStatus);
  }
}

describe('task mutation rate limit: real HTTP, database fixture only', () => {
  it('shared immutable budget produces draft-7 headers through the real library', async () => {
    const { TASK_MUTATION_RATE_LIMIT_OPTIONS: options } = await import('../task-mutation-rate-limit.js');
    expect(Object.isFrozen(options)).toBe(true);
    expect(options).toEqual({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false });
    const app = appWithJson(); app.patch('/task', rateLimit(options), (_req, res) => res.json({ ok: true }));
    const response = await request(app).patch('/task').send({ limit: 99999, skip: true });
    expect(response.status).toBe(200);
    expect(response.headers.ratelimit).toMatch(/limit=300, remaining=299/);
    expect(response.headers['ratelimit-policy']).toBe('300;w=60');
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });
  it.each(['/tasks/:id/headed-takeover', '/:id/headed-takeover'])('POST %s counts failed authentication before database work', async path => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'isolated-rate-test');
    const pool = { query: vi.fn(), connect: vi.fn() }, app = appWithJson();
    const router = express.Router(); registerHeadedTakeoverRoute(router, { pool, path });
    app.use('/one', router); app.use('/two', router);
    const suffix = path.replace(':id', '723b0de1-11a5-4170-ac62-bfba9e50d6ac');
    await burst(app, 'post', ['/one' + suffix, '/two' + suffix], {}, 401);
    const response = await request(app).post('/two' + suffix)
      .set('Authorization', 'Bearer isolated-rate-test').set('X-Session-Id', 'session')
      .send({ requestId: 'd892fb70-fc20-4a66-8031-61cf28c537b5', sessionId: 'session',
        expectedRowVersion: 0, expectedExecutorKind: 'bridge', expectedCurrentRunId: null });
    rateLimited(response);
    expect(pool.query).not.toHaveBeenCalled(); expect(pool.connect).not.toHaveBeenCalled();
  });

  it('field PATCH aliases share budget; request 301 cannot enter owner transaction or terminal hooks', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'isolated-rate-test');
    const pool = { connect: vi.fn(), query: vi.fn(async sql => /ordinary_eligible/.test(sql) ? { rows: [{ id: 'task', ordinary_eligible: true }] } : { rowCount: 1, rows: [{ id: 'task', status: 'in_progress' }] }) };
    const app = appWithJson(), router = express.Router();
    registerTaskPatchRoute(router, { pool, terminalStatuses: ['completed', 'failed', 'cancelled'] });
    app.use('/api/brain/tasks/tasks', router); app.use('/api/brain/tasks', router);
    await burst(app, 'patch', ['/api/brain/tasks/tasks/task', '/api/brain/tasks/task'], { title: 'human title', priority: 'P2' }, 200);
    const before = pool.query.mock.calls.length;
    pool.query.mockResolvedValue({ rows: [{ status: 'in_progress', headed_takeover: { session_id: 'session' } }] });
    rateLimited(await request(app).patch('/api/brain/tasks/task')
      .set('Authorization', 'Bearer isolated-rate-test').set('X-Session-Id', 'session').send({ status: 'completed' }));
    expect(pool.query).toHaveBeenCalledTimes(before); expect(pool.connect).not.toHaveBeenCalled();
    expect(effects.terminal).not.toHaveBeenCalled();
  });

  it('execution PATCH preserves ordinary result-only requests; request 301 performs no new SQL or terminal effects', async () => {
    effects.query.mockImplementation(async sql => /ordinary_eligible/.test(sql) ? { rows: [{ id: 'task', ordinary_eligible: true }] } : { rowCount: 1, rows: [{ id: 'task', status: 'completed', updated_at: 'fixture' }] });
    const { default: router } = await import('../tasks.js');
    const app = appWithJson(); app.use('/api/brain', router);
    await burst(app, 'patch', ['/api/brain/tasks/task'], { result: { evidence: 'existing result' } }, 200);
    expect(effects.query.mock.calls.some(([sql]) => /result = COALESCE/.test(sql))).toBe(true);
    const before = effects.query.mock.calls.length;
    rateLimited(await request(app).patch('/api/brain/tasks/task').send({ status: 'completed', result: { evidence: 'blocked' } }));
    expect(effects.query).toHaveBeenCalledTimes(before); expect(effects.terminal).not.toHaveBeenCalled();
  });
});
