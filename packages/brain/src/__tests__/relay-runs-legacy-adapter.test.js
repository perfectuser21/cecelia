import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockPool,
  mockPatchLegacy,
  mockPatchKernelRunById,
} = vi.hoisted(() => ({
  mockPool: { query: vi.fn(), connect: vi.fn() },
  mockPatchLegacy: vi.fn(),
  mockPatchKernelRunById: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../orchestrator/kernel-run-store.js', () => ({
  createKernelRun: vi.fn(),
  loadKernelRunById: vi.fn(),
  patchLegacyKernelRunByInitiative: mockPatchLegacy,
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
    mockPatchLegacy.mockResolvedValue({
      candidateCount: 1,
      run: {
        id: RUN_ID,
        initiative_id: INITIATIVE_ID,
        phase: 'evaluate',
      },
    });
    mockPatchKernelRunById.mockResolvedValue({
      id: RUN_ID,
      initiative_id: INITIATIVE_ID,
      phase: 'evaluate',
    });
  });

  it('returns 404 without mutation when no candidate exists', async () => {
    mockPatchLegacy.mockResolvedValueOnce({ candidateCount: 0, run: null });
    const app = await buildApp();

    const response = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'evaluate' });

    expect(response.status).toBe(404);
    expect(mockPatchKernelRunById).not.toHaveBeenCalled();
  });

  it('returns 409 and never guesses when an initiative has multiple runs', async () => {
    mockPatchLegacy.mockResolvedValueOnce({ candidateCount: 2, run: null });
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
    expect(mockPatchLegacy).toHaveBeenCalledWith(mockPool, expect.objectContaining({
      rawId: INITIATIVE_ID,
    }));
  });

  it('records deprecation telemetry and delegates one candidate by run id', async () => {
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
    expect(mockPatchLegacy).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        rawId: INITIATIVE_ID,
        patch: expect.objectContaining({ phase: 'evaluate' }),
      }),
    );
  });

  it('treats an ambiguous short initiative prefix as 409', async () => {
    mockPatchLegacy.mockResolvedValueOnce({ candidateCount: 2, run: null });
    const app = await buildApp();

    const response = await request(app)
      .patch('/api/brain/orchestrator/relay-runs/11111111')
      .send({ phase: 'evaluate' });

    expect(response.status).toBe(409);
    expect(mockPatchKernelRunById).not.toHaveBeenCalled();
    expect(mockPatchLegacy).toHaveBeenCalledWith(mockPool, expect.objectContaining({
      rawId: '11111111',
    }));
  });
});
