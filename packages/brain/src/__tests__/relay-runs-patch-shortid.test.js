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

const FULL_UUID = 'dd34e184-0000-4000-8000-000000000001';
const RUN_ID = '11111111-1111-4111-8111-111111111111';

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const app = express();
  app.use(express.json());
  app.set('pool', mockPool);
  app.use('/api/brain/orchestrator', router);
  return app;
}

describe('legacy relay short-id fail-closed adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchLegacy.mockResolvedValue({
      candidateCount: 1,
      run: {
        id: RUN_ID,
        initiative_id: FULL_UUID,
        phase: 'done',
        completed_at: '2026-07-30T00:00:00.000Z',
      },
    });
    mockPatchKernelRunById.mockResolvedValue({
      id: RUN_ID,
      initiative_id: FULL_UUID,
      phase: 'done',
      completed_at: '2026-07-30T00:00:00.000Z',
    });
  });

  it('delegates a unique short-prefix candidate by run id', async () => {
    const app = await buildApp();

    const response = await request(app)
      .patch('/api/brain/orchestrator/relay-runs/dd34e184')
      .send({ phase: 'done' });

    expect(response.status).toBe(200);
    expect(response.body.canonical_run_id).toBe(RUN_ID);
    expect(mockPatchLegacy).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        rawId: 'dd34e184',
        patch: expect.objectContaining({ phase: 'done' }),
      }),
    );
  });

  it('short-prefix candidate query never filters terminal history or limits to latest', async () => {
    mockPatchLegacy.mockResolvedValueOnce({ candidateCount: 0, run: null });
    const app = await buildApp();

    await request(app)
      .patch('/api/brain/orchestrator/relay-runs/dd34e184')
      .send({ phase: 'done' });

    expect(mockPatchLegacy).toHaveBeenCalledWith(mockPool, expect.objectContaining({
      rawId: 'dd34e184',
    }));
  });

  it('returns 409 for more than one candidate instead of choosing by time', async () => {
    mockPatchLegacy.mockResolvedValueOnce({ candidateCount: 2, run: null });
    const app = await buildApp();

    const response = await request(app)
      .patch('/api/brain/orchestrator/relay-runs/dd34e184')
      .send({ phase: 'done' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('ambiguous_legacy_run');
    expect(mockPatchKernelRunById).not.toHaveBeenCalled();
  });

  it('returns 404 containing the unresolved identifier', async () => {
    mockPatchLegacy.mockResolvedValueOnce({ candidateCount: 0, run: null });
    const app = await buildApp();

    const response = await request(app)
      .patch('/api/brain/orchestrator/relay-runs/00000000')
      .send({ phase: 'done' });

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('00000000');
  });

  it.each(['bad-id!', 'gggggggg', 'abcd', 'abcdef123'])(
    'rejects malformed identifier %s before SQL',
    async (id) => {
      const app = await buildApp();
      const response = await request(app)
        .patch(`/api/brain/orchestrator/relay-runs/${encodeURIComponent(id)}`)
        .send({ phase: 'done' });
      expect(response.status).toBe(400);
      expect(mockPatchLegacy).not.toHaveBeenCalled();
    },
  );

  it('full UUID also resolves candidates before exact delegation', async () => {
    const app = await buildApp();

    await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${FULL_UUID}`)
      .send({ phase: 'evaluate' })
      .expect(200);

    expect(mockPatchLegacy).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ rawId: FULL_UUID }),
    );
  });

  it('returns hygienic 500 when candidate lookup fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockPatchLegacy.mockRejectedValueOnce(new Error('secret connection detail'));
    const app = await buildApp();

    const response = await request(app)
      .patch('/api/brain/orchestrator/relay-runs/dd34e184')
      .send({ phase: 'done' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal error' });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('keeps phase and PR URL validation ahead of storage', async () => {
    const app = await buildApp();
    await request(app)
      .patch('/api/brain/orchestrator/relay-runs/dd34e184')
      .send({ phase: 'bogus' })
      .expect(400);
    await request(app)
      .patch('/api/brain/orchestrator/relay-runs/dd34e184')
      .send({ phase: 'done', pr_url: 'http://evil.example' })
      .expect(400);
    expect(mockPatchLegacy).not.toHaveBeenCalled();
  });
});
