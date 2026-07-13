/**
 * POST /orchestrator/relay-runs/:initiative_id — 前台点火建档（Issue 968b6f58 Brain 侧半边）。
 * 幂等：已有 v2 非终态行 → 200 created:false；否则 INSERT host='foreground' → 201。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

const INITIATIVE = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

function mockQueries({ task = { id: INITIATIVE, task_type: 'harness_initiative', payload: { journey_id: 'j-1' } }, existingRun = null } = {}) {
  mockPool.query.mockImplementation(async (sql) => {
    if (/FROM tasks/.test(sql)) return { rows: task ? [task] : [] };
    if (/SELECT[\s\S]*FROM initiative_runs/.test(sql)) return { rows: existingRun ? [existingRun] : [] };
    if (/INSERT INTO initiative_runs/.test(sql)) {
      return { rows: [{ id: 'run-1', initiative_id: INITIATIVE, phase: 'planning', orchestrator_host: 'foreground' }] };
    }
    return { rows: [] };
  });
}

describe('POST /orchestrator/relay-runs/:initiative_id', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('task 不存在 → 404', async () => {
    mockQueries({ task: null });
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({});
    expect(r.status).toBe(404);
  });

  it('task_type 非 harness_initiative → 404', async () => {
    mockQueries({ task: { id: INITIATIVE, task_type: 'dev', payload: {} } });
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({});
    expect(r.status).toBe(404);
  });

  it('非法 phase → 400（不查库）', async () => {
    mockQueries({});
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({ phase: 'bogus' });
    expect(r.status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('首建 → 201 created:true，host=foreground，INSERT 传 journey_id', async () => {
    mockQueries({});
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({});
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(true);
    expect(r.body.run.orchestrator_host).toBe('foreground');
    const insertCall = mockPool.query.mock.calls.find(([sql]) => /INSERT INTO initiative_runs/.test(sql));
    expect(insertCall[0]).toContain("'foreground'");
    expect(insertCall[1]).toEqual([INITIATIVE, 'planning', 'j-1']);
  });

  it('已有 v2 非终态行 → 200 created:false 不 INSERT', async () => {
    mockQueries({ existingRun: { id: 'run-0', initiative_id: INITIATIVE, phase: 'gan', orchestrator_host: 'foreground' } });
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({});
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(false);
    const insertCall = mockPool.query.mock.calls.find(([sql]) => /INSERT INTO initiative_runs/.test(sql));
    expect(insertCall).toBeUndefined();
  });
});
