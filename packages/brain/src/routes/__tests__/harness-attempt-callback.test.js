import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  store: {
    getById: vi.fn(),
    assertFreshRoleSession: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    heartbeat: vi.fn(),
    markRunning: vi.fn(),
  },
  pool: { query: vi.fn() },
}));

vi.mock('../../orchestrator/attempt-store.js', () => ({
  createAttemptStore: () => mocks.store,
}));
vi.mock('../../db.js', () => ({ default: mocks.pool }));
vi.mock('../../lib/harness-thread-lookup.js', () => ({ lookupHarnessThread: vi.fn() }));
vi.mock('../../notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../../lib/harness-orphan-guard.js', () => ({
  handleRelayExitConsistency: vi.fn(async () => ({ action: 'noop' })),
}));

const attemptId = '22222222-2222-4222-8222-222222222222';
const runId = '11111111-1111-4111-8111-111111111111';

const attempt = {
  id: attemptId,
  run_id: runId,
  hop: 4,
  role: 'evaluator',
  provider: 'codex',
  status: 'running',
  task_bundle: {
    inputs: {
      contract_round: 2,
      pull_request: { head_sha: 'sha-1' },
    },
  },
};

const validResult = {
  contract_version: '1.0',
  attempt_id: attemptId,
  status: 'completed',
  summary: 'all checks passed',
  artifacts: [],
  checks: [{ command: 'npm test', exit_code: 0 }],
  decision: { outcome: 'PASS', reason: 'behavior tests passed' },
  error: null,
  provider_metadata: { provider: 'codex', session_id: 'thread-1' },
};

describe('POST /harness/attempts/:attemptId/callback', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.store.getById.mockResolvedValue(attempt);
    mocks.store.assertFreshRoleSession.mockResolvedValue(true);
    mocks.store.complete
      .mockResolvedValueOnce({ attempt: { ...attempt, status: 'completed' }, deduped: false })
      .mockResolvedValueOnce({ attempt: null, deduped: true });
    mocks.store.fail.mockResolvedValue({ attempt: { ...attempt, status: 'failed' }, deduped: false });
    mocks.store.heartbeat.mockResolvedValue({ ...attempt, heartbeat_at: new Date().toISOString() });
    mocks.store.markRunning.mockResolvedValue({ ...attempt, provider_session_id: 'thread-live' });
    mocks.pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { default: router } = await import('../harness-callback.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('校验、完成 attempt，并让重复 callback 幂等返回 deduped', async () => {
    const first = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .send(validResult);
    const second = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .send(validResult);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, deduped: false });
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    expect(mocks.store.assertFreshRoleSession).toHaveBeenCalledWith({
      runId,
      attemptId,
      role: 'evaluator',
      sessionId: 'thread-1',
    });
  });

  it('evaluator decision 写入 SHA 锚定的 append-only verdict 行', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .send(validResult);

    expect(response.status).toBe(200);
    const verdictCall = mocks.pool.query.mock.calls.find(([sql]) => /verdict:evaluate/.test(sql));
    expect(verdictCall).toBeTruthy();
    expect(verdictCall[1].join(' ')).toContain('sha-1');
  });

  it('reviewer 只写 round/verdict，不接收 proposer transcript', async () => {
    mocks.store.getById.mockResolvedValueOnce({
      ...attempt,
      role: 'reviewer',
      task_bundle: { inputs: { contract_round: 3 } },
    });
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .send({
        ...validResult,
        decision: { outcome: 'APPROVED', reason: 'contract covers PRD' },
      });

    expect(response.status).toBe(200);
    const verdictCall = mocks.pool.query.mock.calls.find(([sql]) => /verdict:reviewer/.test(sql));
    expect(verdictCall).toBeTruthy();
    expect(verdictCall[1].join(' ')).toContain('3');
  });

  it('跨角色/attempt session 复用冲突返回 409，且不完成 attempt', async () => {
    mocks.store.assertFreshRoleSession.mockRejectedValueOnce(new Error('role_session_reuse'));
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .send(validResult);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/role_session_reuse/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('拒绝 callback 冒充另一个 provider', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .send({
        ...validResult,
        provider_metadata: { provider: 'claude', session_id: 'session-x' },
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/provider_mismatch/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('拒绝 attempt_id 不匹配或 schema 不完整的结果', async () => {
    const mismatch = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .send({ ...validResult, attempt_id: '33333333-3333-4333-8333-333333333333' });
    expect(mismatch.status).toBe(400);

    const invalid = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .send({ status: 'completed' });
    expect(invalid.status).toBe(400);
  });

  it('failed result 走 fail 终态，不伪装为 completed', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .send({
        ...validResult,
        status: 'failed',
        summary: 'provider process failed',
        decision: null,
        error: { code: 'provider_exit', message: 'exit 1' },
      });

    expect(response.status).toBe(200);
    expect(mocks.store.fail).toHaveBeenCalledWith(attemptId, {
      code: 'provider_exit',
      message: 'exit 1',
      status: 'failed',
    });
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('worker 用 lease owner 续租，跨设备 watchdog 不会误领活 attempt', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
      .send({ lease_owner: 'brain-1:123', lease_seconds: 180 });

    expect(response.status).toBe(200);
    expect(mocks.store.heartbeat).toHaveBeenCalledWith(attemptId, {
      leaseOwner: 'brain-1:123',
      leaseSeconds: 180,
    });
  });

  it('worker 一拿到 provider session 就转 running 并持久化，崩溃后可原 session resume', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
      .send({
        lease_owner: 'brain-1:123',
        lease_seconds: 180,
        provider_session_id: 'thread-live',
      });

    expect(response.status).toBe(200);
    expect(mocks.store.markRunning).toHaveBeenCalledWith(attemptId, {
      leaseOwner: 'brain-1:123',
      providerSessionId: 'thread-live',
      leaseSeconds: 180,
    });
    expect(mocks.store.heartbeat).not.toHaveBeenCalled();
  });
});
