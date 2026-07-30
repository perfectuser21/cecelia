/**
 * Legacy POST /orchestrator/relay-runs/:initiative_id compatibility adapter.
 *
 * It may remain during the PR2 migration window, but it must never infer a
 * task identity or create an identity-less v2 run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockPool,
  mockCreateKernelRun,
} = vi.hoisted(() => ({
  mockPool: { query: vi.fn(), connect: vi.fn() },
  mockCreateKernelRun: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../orchestrator/kernel-run-store.js', () => ({
  createKernelRun: mockCreateKernelRun,
  loadKernelRunById: vi.fn(),
  patchLegacyKernelRunByInitiative: vi.fn(),
  patchKernelRunById: vi.fn(),
}));

const INITIATIVE_ID = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const RUN_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const app = express();
  app.use(express.json());
  app.use('/api/brain/orchestrator', router);
  return app;
}

describe('legacy POST /orchestrator/relay-runs/:initiative_id', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.connect.mockReset();
    mockCreateKernelRun.mockReset();
    mockCreateKernelRun.mockResolvedValue({
      created: true,
      run: {
        id: RUN_ID,
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        phase: 'planning',
        orchestrator_host: 'foreground',
        created_source: 'foreground_handoff',
      },
    });
  });

  it('rejects an empty body instead of inferring current_task_id', async () => {
    const app = await buildApp();

    const response = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/current_task_id.*created_source/);
    expect(mockCreateKernelRun).not.toHaveBeenCalled();
  });

  it('rejects an invalid phase before opening a transaction', async () => {
    const app = await buildApp();

    const response = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
        phase: 'bogus',
      });

    expect(response.status).toBe(400);
    expect(mockCreateKernelRun).not.toHaveBeenCalled();
  });

  it('delegates a fully identified request to the transactional authority', async () => {
    const app = await buildApp();

    const response = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
        phase: 'planning',
        journey_id: null,
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      created: true,
      run: {
        id: RUN_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
      },
    });
    expect(mockCreateKernelRun).toHaveBeenCalledWith(mockPool, {
      taskId: TASK_ID,
      initiativeId: INITIATIVE_ID,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'foreground',
      deadlineHours: 6,
      createdSource: 'foreground_handoff',
    });
  });

  it('returns the existing active run as an idempotent 200', async () => {
    mockCreateKernelRun.mockResolvedValueOnce({
      created: false,
      run: {
        id: RUN_ID,
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        phase: 'gan',
        created_source: 'foreground_handoff',
      },
    });
    const app = await buildApp();

    const response = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
      });

    expect(response.status).toBe(200);
    expect(response.body.created).toBe(false);
    expect(response.body.run.id).toBe(RUN_ID);
  });
});
