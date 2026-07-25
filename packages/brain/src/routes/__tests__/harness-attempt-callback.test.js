import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';

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
const callbackToken = 'attempt-callback-secret';
const leaseOwner = 'brain-1:123';

const attempt = {
  id: attemptId,
  run_id: runId,
  hop: 4,
  role: 'evaluator',
  provider: 'codex',
  status: 'running',
  lease_owner: leaseOwner,
  callback_secret_hash: createHash('sha256').update(callbackToken).digest('hex'),
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

function postCallback(app, body = validResult, token = callbackToken, owner = leaseOwner) {
  let call = request(app)
    .post(`/api/brain/harness/attempts/${attemptId}/callback`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Harness-Lease-Owner', owner);
  return call.send(body);
}

describe('POST /harness/attempts/:attemptId/callback', () => {
  let app;

  beforeEach(async () => {
    vi.resetAllMocks();
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
    const completedAttempt = { ...attempt, status: 'completed', result: validResult };
    mocks.store.getById
      .mockReset()
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce(completedAttempt)
      .mockResolvedValueOnce(completedAttempt);
    const first = await postCallback(app);
    const second = await postCallback(app);

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

  it('无密钥或错密钥的 callback 返回 401，伪造 reviewer APPROVED 不得写 verdict', async () => {
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'reviewer' });
    const forged = {
      ...validResult,
      decision: { outcome: 'APPROVED', reason: 'forged approval' },
    };

    const missing = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .set('X-Harness-Lease-Owner', leaseOwner)
      .send(forged);
    const wrong = await postCallback(app, forged, 'wrong-secret');

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mocks.store.complete).not.toHaveBeenCalled();
    expect(mocks.pool.query.mock.calls.some(([sql]) => /verdict:reviewer/.test(sql))).toBe(false);
  });

  it('终态 callback 的 lease_owner 不匹配时返回 409', async () => {
    const response = await postCallback(app, validResult, callbackToken, 'other-owner');
    expect(response.status).toBe(409);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('认证后发生换租时拒绝旧 worker，且不得追加 evaluator verdict', async () => {
    mocks.store.complete.mockReset().mockResolvedValue({ attempt: null, deduped: true });
    mocks.store.getById
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce({ ...attempt, status: 'starting', lease_owner: 'brain-2:456' });

    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/lease/i);
    expect(mocks.pool.query.mock.calls.some(([sql]) => /verdict:evaluate/.test(sql))).toBe(false);
  });

  it('evaluator decision 写入 SHA 锚定的 append-only verdict 行', async () => {
    const response = await postCallback(app);

    expect(response.status).toBe(200);
    const verdictCall = mocks.pool.query.mock.calls.find(([sql]) => /verdict:evaluate/.test(sql));
    expect(verdictCall).toBeTruthy();
    expect(verdictCall[1].join(' ')).toContain('sha-1');
  });

  it('reviewer verdict 从服务端 TaskBundle 锚定 round/SHA，不接收 worker 自报 SHA', async () => {
    const contractSha = 'a'.repeat(40);
    mocks.store.getById.mockResolvedValueOnce({
      ...attempt,
      role: 'reviewer',
      task_bundle: { inputs: { contract_round: 3, contract_sha: contractSha } },
    });
    const response = await postCallback(app, {
        ...validResult,
        decision: { outcome: 'APPROVED', reason: 'contract covers PRD', contract_sha: 'b'.repeat(40) },
      });

    expect(response.status).toBe(200);
    const verdictCall = mocks.pool.query.mock.calls.find(([sql]) => /verdict:reviewer/.test(sql));
    expect(verdictCall).toBeTruthy();
    expect(verdictCall[1].join(' ')).toContain('3');
    expect(verdictCall[1].join(' ')).toContain(contractSha);
    expect(verdictCall[1].join(' ')).not.toContain('b'.repeat(40));
  });

  it('generator-fix 未声明 SHA 时以 trigger SHA 写入已验证 callback', async () => {
    const triggerSha = 'a'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.complete.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'completed' },
      deduped: false,
    });
    mocks.pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT r.pr_url')) {
        return { rows: [{ pr_url: 'https://github.com/acme/repo/pull/42', trigger_sha: triggerSha }] };
      }
      return { rows: [], rowCount: 1 };
    });
    app.set('kernelPrHeadResolver', vi.fn(async () => triggerSha));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: ['Codex completed the requested fix.'],
      checks: [],
      decision: null,
    });

    expect(response.status).toBe(200);
    const callbackCalls = mocks.pool.query.mock.calls.filter(([sql]) => (
      sql.includes('verdict:generator-fix-callback')
    ));
    expect(callbackCalls).toHaveLength(1);
    const detail = JSON.parse(callbackCalls[0][1][6]);
    expect(detail).toMatchObject({
      verification_status: 'verified',
      pr_head_sha: triggerSha,
    });
  });

  it('generator-fix 未声明 SHA 且 resolver 失败时以 trigger SHA 写 pending callback', async () => {
    const triggerSha = 'a'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.complete.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'completed' },
      deduped: false,
    });
    mocks.pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT r.pr_url')) {
        return { rows: [{ pr_url: 'https://github.com/acme/repo/pull/42', trigger_sha: triggerSha }] };
      }
      return { rows: [], rowCount: 1 };
    });
    app.set('kernelPrHeadResolver', vi.fn(async () => { throw new Error('GitHub unavailable'); }));

    const response = await postCallback(app, {
      ...validResult,
      artifacts: ['Codex completed the requested fix.'],
      checks: [],
      decision: null,
    });

    expect(response.status).toBe(200);
    const callbackCalls = mocks.pool.query.mock.calls.filter(([sql]) => (
      sql.includes('verdict:generator-fix-callback')
    ));
    expect(callbackCalls).toHaveLength(1);
    const detail = JSON.parse(callbackCalls[0][1][6]);
    expect(detail).toMatchObject({
      verification_status: 'verification_pending',
      pr_head_sha: triggerSha,
    });
    expect(detail.no_progress_reason).not.toBe('callback_sha_unverified');
  });

  it('generator-fix blocked 也是已收到的终态 callback，必须持久化供收敛回放', async () => {
    const triggerSha = 'a'.repeat(40);
    const advancedSha = 'b'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.complete.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'blocked' },
      deduped: false,
    });
    mocks.pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT r.pr_url')) {
        return { rows: [{ pr_url: 'https://github.com/acme/repo/pull/42', trigger_sha: triggerSha }] };
      }
      return { rows: [], rowCount: 1 };
    });
    app.set('kernelPrHeadResolver', vi.fn(async () => advancedSha));

    const response = await postCallback(app, {
      ...validResult,
      status: 'blocked',
      summary: 'contract environment unavailable',
      artifacts: [],
      checks: [],
      decision: null,
    });

    expect(response.status).toBe(200);
    const callbackCalls = mocks.pool.query.mock.calls.filter(([sql]) => (
      sql.includes('verdict:generator-fix-callback')
    ));
    expect(callbackCalls).toHaveLength(1);
    expect(JSON.parse(callbackCalls[0][1][6])).toMatchObject({
      status: 'blocked',
      verification_status: 'verified',
      pr_head_sha: advancedSha,
    });
  });

  it('跨角色/attempt session 复用冲突返回 409，且不完成 attempt', async () => {
    mocks.store.assertFreshRoleSession.mockRejectedValueOnce(new Error('role_session_reuse'));
    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/role_session_reuse/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('拒绝 callback 冒充另一个 provider', async () => {
    const response = await postCallback(app, {
        ...validResult,
        provider_metadata: { provider: 'claude', session_id: 'session-x' },
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/provider_mismatch/);
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('拒绝 attempt_id 不匹配或 schema 不完整的结果', async () => {
    const mismatch = await postCallback(app, {
      ...validResult,
      attempt_id: '33333333-3333-4333-8333-333333333333',
    });
    expect(mismatch.status).toBe(400);

    const invalid = await postCallback(app, { status: 'completed' });
    expect(invalid.status).toBe(400);
  });

  it('failed result 走 fail 终态，不伪装为 completed', async () => {
    const response = await postCallback(app, {
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
    }, { leaseOwner });
    expect(mocks.store.complete).not.toHaveBeenCalled();
  });

  it('worker 用 lease owner 续租，跨设备 watchdog 不会误领活 attempt', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
      .set('Authorization', `Bearer ${callbackToken}`)
      .send({ lease_owner: 'brain-1:123', lease_seconds: 180 });

    expect(response.status).toBe(200);
    expect(mocks.store.heartbeat).toHaveBeenCalledWith(attemptId, {
      leaseOwner: 'brain-1:123',
      leaseSeconds: 180,
    });
  });

  it('heartbeat 同样拒绝无密钥请求', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
      .send({ lease_owner: leaseOwner, lease_seconds: 180 });
    expect(response.status).toBe(401);
    expect(mocks.store.heartbeat).not.toHaveBeenCalled();
  });

  it('worker 一拿到 provider session 就转 running 并持久化，崩溃后可原 session resume', async () => {
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/heartbeat`)
      .set('Authorization', `Bearer ${callbackToken}`)
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

  it('同一 attempt 的终态 callback 连续认证失败 10 次后返回 429，且不再访问 DB', async () => {
    const limitedAttemptId = '33333333-3333-4333-8333-333333333333';
    const responses = [];

    for (let requestNumber = 0; requestNumber < 11; requestNumber += 1) {
      responses.push(await request(app)
        .post(`/api/brain/harness/attempts/${limitedAttemptId}/callback`)
        .set('Authorization', 'Bearer wrong-secret')
        .set('X-Harness-Lease-Owner', leaseOwner)
        .send({}));
    }

    expect(responses.slice(0, 10).every(({ status }) => status === 401)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(mocks.store.getById).toHaveBeenCalledTimes(10);
  });

  it('同一 attempt 的 heartbeat 连续认证失败 30 次后返回 429，且不再访问 DB', async () => {
    const limitedAttemptId = '44444444-4444-4444-8444-444444444444';
    const responses = [];

    for (let requestNumber = 0; requestNumber < 31; requestNumber += 1) {
      responses.push(await request(app)
        .post(`/api/brain/harness/attempts/${limitedAttemptId}/heartbeat`)
        .send({ lease_owner: leaseOwner, lease_seconds: 180 }));
    }

    expect(responses.slice(0, 30).every(({ status }) => status === 401)).toBe(true);
    expect(responses[30].status).toBe(429);
    expect(mocks.store.getById).toHaveBeenCalledTimes(30);
  });
});
