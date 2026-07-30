import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockPool,
  mockLoadKernelRunById,
  mockPatchKernelRunById,
} = vi.hoisted(() => ({
  mockPool: { query: vi.fn(), connect: vi.fn() },
  mockLoadKernelRunById: vi.fn(),
  mockPatchKernelRunById: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../orchestrator/kernel-run-store.js', () => ({
  createKernelRun: vi.fn(),
  loadKernelRunById: mockLoadKernelRunById,
  patchLegacyKernelRunByInitiative: vi.fn(),
  patchKernelRunById: mockPatchKernelRunById,
}));

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const INITIATIVE_ID = '33333333-3333-4333-8333-333333333333';
const RUN = {
  id: RUN_ID,
  initiative_id: INITIATIVE_ID,
  current_task_id: TASK_ID,
  phase: 'generate',
};

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const app = express();
  app.use(express.json());
  app.set('pool', mockPool);
  app.use('/api/brain/orchestrator', router);
  return app;
}

describe('exact relay run API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET by-id loads only the authoritative run id', async () => {
    mockLoadKernelRunById.mockResolvedValueOnce(RUN);
    const app = await buildApp();

    const response = await request(app)
      .get(`/api/brain/orchestrator/relay-runs/by-id/${RUN_ID}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(RUN);
    expect(mockLoadKernelRunById).toHaveBeenCalledWith(mockPool, RUN_ID);
  });

  it('GET by-id rejects malformed ids before touching storage', async () => {
    const app = await buildApp();

    const response = await request(app)
      .get('/api/brain/orchestrator/relay-runs/by-id/not-a-uuid');

    expect(response.status).toBe(400);
    expect(mockLoadKernelRunById).not.toHaveBeenCalled();
  });

  it('PATCH by-id delegates the same run id to exact mutation', async () => {
    mockPatchKernelRunById.mockResolvedValueOnce({
      ...RUN,
      phase: 'evaluate',
      pr_url: 'https://github.com/perfectuser21/cecelia/pull/4502',
    });
    const app = await buildApp();

    const response = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/by-id/${RUN_ID}`)
      .send({
        phase: 'evaluate',
        pr_url: 'https://github.com/perfectuser21/cecelia/pull/4502',
      });

    expect(response.status).toBe(200);
    expect(response.body.phase).toBe('evaluate');
    expect(mockPatchKernelRunById).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        runId: RUN_ID,
        phase: 'evaluate',
      }),
    );
  });

  it('PATCH by-id returns 404 when the exact row is absent', async () => {
    mockPatchKernelRunById.mockResolvedValueOnce(null);
    const app = await buildApp();

    const response = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/by-id/${RUN_ID}`)
      .send({ phase: 'evaluate' });

    expect(response.status).toBe(404);
  });

  it('initiative history is read-only and deterministically ordered', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [RUN] });
    const app = await buildApp();

    const response = await request(app)
      .get(`/api/brain/orchestrator/relay-initiatives/${INITIATIVE_ID}/runs`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([RUN]);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE initiative_id\s*=\s*\$1/i);
    expect(sql).toMatch(/ORDER BY started_at DESC,\s*id DESC/i);
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/i);
    expect(params).toEqual([INITIATIVE_ID]);
  });
});
