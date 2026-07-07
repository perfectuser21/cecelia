/**
 * Contract Test: POST /api/brain/orchestrator/relay-runs/:initiative_id
 * Sprint: cp-07071706-harness-judge-api
 *
 * 覆盖：
 * 1. initiative_id 不存在 → 404 + { error: "initiative task not found" }
 * 2. task_type ≠ harness_initiative → 404 + { error: "task_type must be harness_initiative..." }
 * 3. 已有 v2 未终态行 → 200 + 现有行（幂等）
 * 4. 无 v2 未终态行 → 201 + 新建行（INSERT）
 * 5. DB 失败 → 500 + { error }
 * 6. Content-Type: application/json 所有响应
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

let app;

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

const INITIATIVE_ID = 'aaaabbbb-1111-2222-3333-444455556666';

const EXISTING_RUN = {
  id: 'run-id-xxxx',
  initiative_id: INITIATIVE_ID,
  phase: 'A_planning',
  orchestrator_version: 'v2',
  orchestrator_host: 'foreground',
  started_at: '2026-07-07T10:00:00.000Z',
  deadline_at: '2026-07-07T16:00:00.000Z',
  completed_at: null,
  failure_reason: null,
};

const NEW_RUN = {
  id: 'run-id-yyyy',
  initiative_id: INITIATIVE_ID,
  phase: 'planning',
  orchestrator_version: 'v2',
  orchestrator_host: 'foreground',
  started_at: '2026-07-07T10:00:00.000Z',
  deadline_at: '2026-07-07T16:00:00.000Z',
  completed_at: null,
  failure_reason: null,
};

describe('POST /api/brain/orchestrator/relay-runs/:initiative_id — Contract Tests', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    app = await buildApp();
  });

  it('GP-1: initiative_id 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // task not found
    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send();
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('initiative task not found');
  });

  it('GP-2: task_type ≠ harness_initiative → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: INITIATIVE_ID, task_type: 'harness_task' }] });
    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send();
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/task_type must be harness_initiative/);
  });

  it('GP-3: 已有 v2 未终态行 → 200 + 现有行（幂等）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: INITIATIVE_ID, task_type: 'harness_initiative' }] }) // task check
      .mockResolvedValueOnce({ rows: [EXISTING_RUN] }); // existing run
    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(EXISTING_RUN.id);
    expect(res.body.phase).toBe('A_planning');
    // INSERT 不应被调用（只有 2 次 query：task check + existing run check）
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('GP-4: 无 v2 未终态行 → 201 + 新建行', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: INITIATIVE_ID, task_type: 'harness_initiative' }] }) // task check
      .mockResolvedValueOnce({ rows: [] }) // no existing run
      .mockResolvedValueOnce({ rows: [NEW_RUN] }); // INSERT
    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send();
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(NEW_RUN.id);
    expect(res.body.orchestrator_version).toBe('v2');
    expect(res.body.orchestrator_host).toBe('foreground');
  });

  it('GP-5: DB 失败 → 500 + { error }', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));
    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send();
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('Content-Type: application/json（所有响应）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send();
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
