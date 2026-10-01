import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('canonical POST /orchestrator/relay-runs', () => {
  afterEach(() => vi.unstubAllEnvs());
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

  it('显式再基canonical入口缺少或错误internal token时401，合法token转交真实输入', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'synthetic-internal-token');
    const app = await buildApp();
    const body = { initiative_id: INITIATIVE_ID, current_task_id: TASK_ID,
      created_source: 'explicit_recovery', predecessor_run_id: RUN_ID,
      recovery_rebase: { expected_receipt_id: TASK_ID, base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40),
        actor: 'session:operator', reason: '真实恢复', sprint_dir: 'sprints' } };
    for (const token of ['', 'wrong']) {
      const response = await request(app).post('/api/brain/orchestrator/relay-runs')
        .set('X-Internal-Token', token).send(body);
      expect(response.status).toBe(401); expect(mockCreateKernelRun).not.toHaveBeenCalled();
    }
    const response = await request(app).post('/api/brain/orchestrator/relay-runs')
      .set('X-Internal-Token', 'synthetic-internal-token').send(body);
    expect(response.status).toBe(201);
    expect(mockCreateKernelRun.mock.calls[0][1].recoveryRebase).toEqual(body.recovery_rebase);
  });

  it('生产未配置鉴权时再基入口503；旧adapter不能携带恢复请求', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', ''); vi.stubEnv('NODE_ENV', 'production');
    const app = await buildApp();
    const body = { initiative_id: INITIATIVE_ID, current_task_id: TASK_ID,
      created_source: 'explicit_recovery', recovery_rebase: {} };
    expect((await request(app).post('/api/brain/orchestrator/relay-runs').send(body)).status).toBe(503);
    expect((await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`).send(body)).status).toBe(400);
    expect(mockCreateKernelRun).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { initiative_id: INITIATIVE_ID },
    {
      initiative_id: INITIATIVE_ID,
      current_task_id: TASK_ID,
    },
  ])('requires initiative, task, and source identity: %j', async (body) => {
    const app = await buildApp();

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send(body);

    expect(response.status).toBe(400);
    expect(mockCreateKernelRun).not.toHaveBeenCalled();
  });

  it('returns the authoritative run id and identity', async () => {
    const app = await buildApp();

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send({
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
        phase: 'planning',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      created: true,
      run: {
        id: RUN_ID,
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
      },
    });
  });

  it('passes an explicit hybrid commander mode to the Kernel store', async () => {
    const app = await buildApp();

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send({
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
        commander_mode: 'hybrid',
      });

    expect(response.status).toBe(201);
    expect(mockCreateKernelRun).toHaveBeenCalledWith(mockPool, expect.objectContaining({
      commanderMode: 'hybrid',
    }), {});
  });

  it('defaults commander mode to kernel-only', async () => {
    const app = await buildApp();

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send({
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
      });

    expect(response.status).toBe(201);
    // 第 27 批（决策 e3afa828）：API 不固化缺省，undefined 透传 store 统一裁决（store 缺省 hybrid）
    expect(mockCreateKernelRun).toHaveBeenCalledWith(mockPool, expect.objectContaining({
      commanderMode: undefined,
    }), {});
  });

  it('passes the declared predecessor identity for explicit recovery', async () => {
    const app = await buildApp();
    const predecessorRunId = '77777777-7777-4777-8777-777777777777';

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send({
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'explicit_recovery',
        predecessor_run_id: predecessorRunId,
      });

    expect(response.status).toBe(201);
    expect(mockCreateKernelRun).toHaveBeenCalledWith(mockPool, expect.objectContaining({
      createdSource: 'explicit_recovery',
      predecessorRunId,
    }), {});
  });

  it('rejects an invalid commander mode without calling the Kernel store', async () => {
    const app = await buildApp();

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send({
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
        commander_mode: 'unsafe-mode',
      });

    expect(response.status).toBe(400);
    expect(mockCreateKernelRun).not.toHaveBeenCalled();
  });

  it('fails closed when the task is not eligible', async () => {
    mockCreateKernelRun.mockRejectedValueOnce(
      new Error(`kernel run task ${TASK_ID} not eligible`),
    );
    const app = await buildApp();

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send({
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('not eligible');
  });
});
