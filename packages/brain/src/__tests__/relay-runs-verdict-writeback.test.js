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

const INITIATIVE_ID = 'aaaabbbb-1111-4222-8333-444455556666';
const RUN_ID = '11111111-1111-4111-8111-111111111111';

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const app = express();
  app.use(express.json());
  app.set('pool', mockPool);
  app.use('/api/brain/orchestrator', router);
  return app;
}

describe('legacy verdict/cost adapter delegates normalized fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: RUN_ID }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockPatchKernelRunById.mockResolvedValue({
      id: RUN_ID,
      initiative_id: INITIATIVE_ID,
      phase: 'done',
      judge_verdict: 'PASS',
      cost_usd: 1.23,
    });
  });

  async function patch(body) {
    const app = await buildApp();
    return request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send(body);
  }

  it('normalizes verdict and numeric cost into the exact store call', async () => {
    const response = await patch({
      phase: 'done',
      verdict: 'pass',
      cost: '1.23',
      pr_url: 'https://github.com/x/y/pull/1',
    });
    expect(response.status).toBe(200);

    expect(mockPatchKernelRunById).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        runId: RUN_ID,
        phase: 'done',
        judgeVerdict: 'PASS',
        costUsd: 1.23,
        prUrl: 'https://github.com/x/y/pull/1',
      }),
    );
  });

  it('keeps invalid verdict best-effort and reports a warning', async () => {
    const response = await patch({ phase: 'done', verdict: 'MAYBE' });
    expect(response.status).toBe(200);
    expect(mockPatchKernelRunById).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ judgeVerdict: null }),
    );
    expect(response.body.warnings).toContain('verdict_ignored');
  });

  it('keeps negative cost best-effort and reports a warning', async () => {
    const response = await patch({ phase: 'done', cost: -1 });
    expect(response.status).toBe(200);
    expect(mockPatchKernelRunById).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ costUsd: null }),
    );
    expect(response.body.warnings).toContain('cost_ignored');
  });

  it('passes FIXED evaluator verdict through unchanged', async () => {
    const response = await patch({ phase: 'evaluate', evaluate_verdict: 'FIXED' });
    expect(response.status).toBe(200);
    expect(mockPatchKernelRunById).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        phase: 'evaluate',
        evaluateVerdict: 'FIXED',
      }),
    );
  });

  it('uses nulls when optional verdict and cost fields are absent', async () => {
    const response = await patch({ phase: 'done' });
    expect(response.status).toBe(200);
    expect(mockPatchKernelRunById).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        evaluateVerdict: null,
        judgeVerdict: null,
        costUsd: null,
      }),
    );
    expect(response.body).not.toHaveProperty('warnings');
  });
});
