import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockPool,
  mockPatchKernelRunById,
} = vi.hoisted(() => ({
  mockPool: { query: vi.fn(), connect: vi.fn() },
  mockPatchKernelRunById: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../orchestrator/kernel-run-store.js', () => ({
  createKernelRun: vi.fn(),
  loadKernelRunById: vi.fn(),
  patchKernelRunById: mockPatchKernelRunById,
}));

const INITIATIVE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_RUN_ID = '33333333-3333-4333-8333-333333333333';

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const app = express();
  app.use(express.json());
  app.set('pool', mockPool);
  app.use('/api/brain/orchestrator', router);
  return app;
}

describe('legacy initiative-addressed relay mutation adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchKernelRunById.mockResolvedValue({
      id: RUN_ID,
      initiative_id: INITIATIVE_ID,
      phase: 'evaluate',
    });
  });

  it('returns 404 without mutation when no candidate exists', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const app = await buildApp();

    const response = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'evaluate' });

    expect(response.status).toBe(404);
    expect(mockPatchKernelRunById).not.toHaveBeenCalled();
  });

  it('returns 409 and never guesses when an initiative has multiple runs', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: RUN_ID }, { id: OTHER_RUN_ID }],
    });
    const app = await buildApp();

    const response = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'evaluate' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'ambiguous_legacy_run',
      candidate_count: 2,
    });
    expect(mockPatchKernelRunById).not.toHaveBeenCalled();
    const [sql] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/SELECT id/i);
    expect(sql).not.toMatch(/LIMIT\s+1/i);
  });

  it('records deprecation telemetry and delegates one candidate by run id', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: RUN_ID }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const app = await buildApp();

    const response = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'evaluate' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: RUN_ID,
      canonical_run_id: RUN_ID,
      deprecated: true,
    });
    expect(mockPatchKernelRunById).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ runId: RUN_ID, phase: 'evaluate' }),
    );
    const eventCall = mockPool.query.mock.calls.find(([sql]) => (
      /INSERT INTO cecelia_events/i.test(sql)
    ));
    expect(eventCall).toBeTruthy();
    expect(eventCall[0]).toContain("'legacy_relay_mutation'");
    expect(eventCall[1][0]).toContain(RUN_ID);
  });

  it('treats an ambiguous short initiative prefix as 409', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: RUN_ID }, { id: OTHER_RUN_ID }],
    });
    const app = await buildApp();

    const response = await request(app)
      .patch('/api/brain/orchestrator/relay-runs/11111111')
      .send({ phase: 'evaluate' });

    expect(response.status).toBe(409);
    expect(mockPatchKernelRunById).not.toHaveBeenCalled();
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/initiative_id::text LIKE \$1/i);
    expect(sql).not.toMatch(/LIMIT\s+1/i);
    expect(params).toEqual(['11111111%']);
  });
});
