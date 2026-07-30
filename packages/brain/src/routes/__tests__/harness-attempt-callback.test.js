import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { signMachineAttestation } from '../../orchestrator/machine-attestation.js';

const mocks = vi.hoisted(() => ({
  store: {
    getById: vi.fn(),
    assertFreshRoleSession: vi.fn(),
    recordCallbackTerminal: vi.fn(),
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
const fleetSecret = 'kernel-fleet-bridge-secret-at-least-32-bytes';
const localMachineId = 'us-mac-m4';
const remoteMachineId = 'xian-mac-m4';
const remoteJobId = 'xian-job-7';
const credentialRef = '33333333-3333-4333-8333-333333333333';

const attempt = {
  id: attemptId,
  run_id: runId,
  hop: 4,
  role: 'evaluator',
  provider: 'codex',
  status: 'running',
  lease_owner: leaseOwner,
  lease_generation: 0,
  requested_machine_id: localMachineId,
  actual_machine_id: localMachineId,
  execution_transport: 'local-docker',
  remote_job_id: null,
  machine_attestation_status: 'local',
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

function commanderAttempt(overrides = {}) {
  return {
    ...attempt,
    role: 'commander',
    task_bundle: {
      expected_output: 'commander-directive/v1',
      inputs: {
        commander_bundle: {
          run_id: runId,
          commander_attempt_id: attemptId,
          event_cursor: 5,
        },
      },
    },
    ...overrides,
  };
}

function commanderResult(overrides = {}) {
  return {
    contract_version: '1.0',
    attempt_id: attemptId,
    status: 'completed',
    summary: 'Continue the current Kernel decision.',
    artifacts: [],
    checks: [],
    decision: {
      schema: 'commander-directive/v1',
      run_id: runId,
      event_cursor: 5,
      action: 'continue_default',
      reason: 'Continue the current Kernel decision.',
      evidence_refs: ['event:5'],
    },
    error: null,
    provider_metadata: { provider: 'codex', session_id: 'commander-session' },
    ...overrides,
  };
}

function remoteAttempt(overrides = {}) {
  return {
    ...attempt,
    requested_machine_id: remoteMachineId,
    actual_machine_id: remoteMachineId,
    execution_transport: 'remote-bridge',
    remote_job_id: remoteJobId,
    machine_attestation_status: 'verified',
    ...overrides,
  };
}

function remoteResult(overrides = {}) {
  const machineId = overrides.machine_id ?? remoteMachineId;
  const jobId = overrides.job_id ?? remoteJobId;
  const attestation = overrides.machine_attestation ?? signMachineAttestation({
    secret: fleetSecret,
    attemptId,
    machineId,
    jobId,
  });
  return {
    ...validResult,
    provider_metadata: {
      ...validResult.provider_metadata,
      machine_id: machineId,
      machine_attestation: attestation,
    },
  };
}

function fleetAttempt(overrides = {}) {
  return {
    ...attempt,
    requested_machine_id: remoteMachineId,
    actual_machine_id: remoteMachineId,
    execution_transport: 'fleet-worker',
    remote_job_id: remoteJobId,
    machine_attestation_status: 'verified',
    ...overrides,
  };
}

function fleetResult(overrides = {}) {
  return {
    ...validResult,
    provider_metadata: {
      ...validResult.provider_metadata,
      credential_ref: credentialRef,
      credential_copy_mutated: false,
      ...overrides,
    },
  };
}

function postCallback(
  app,
  body = validResult,
  token = callbackToken,
  owner = leaseOwner,
  generation = 0,
) {
  let call = request(app)
    .post(`/api/brain/harness/attempts/${attemptId}/callback`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Harness-Lease-Owner', owner)
    .set('X-Harness-Lease-Generation', String(generation));
  return call.send(body);
}

it('production server 从环境注入 bridge token 且不记录 secret', () => {
  const serverSource = readFileSync(new URL('../../../server.js', import.meta.url), 'utf8');

  expect(serverSource).toContain(
    "app.set('kernelFleetBridgeToken', process.env.KERNEL_FLEET_BRIDGE_TOKEN);",
  );
  expect(serverSource).not.toMatch(
    /console\.(?:log|warn|error)\([\s\S]{0,200}process\.env\.KERNEL_FLEET_BRIDGE_TOKEN/,
  );
});

describe('POST /harness/attempts/:attemptId/callback', () => {
  let app;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    mocks.store.getById.mockResolvedValue(attempt);
    mocks.store.assertFreshRoleSession.mockResolvedValue(true);
    let callbackCount = 0;
    mocks.store.recordCallbackTerminal.mockImplementation(async ({ result }) => {
      callbackCount += 1;
      return {
        attempt: { ...attempt, status: result.status, result },
        deduped: callbackCount > 1,
      };
    });
    mocks.store.fail.mockResolvedValue({ attempt: { ...attempt, status: 'failed' }, deduped: false });
    mocks.store.heartbeat.mockResolvedValue({ ...attempt, heartbeat_at: new Date().toISOString() });
    mocks.store.markRunning.mockResolvedValue({ ...attempt, provider_session_id: 'thread-live' });
    mocks.pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { default: router } = await import('../harness-callback.js');
    app = express();
    app.set('kernelFleetBridgeToken', fleetSecret);
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('接受 machine attestation 与 launch receipt 一致的 xian callback', async () => {
    mocks.store.getById.mockResolvedValue(remoteAttempt());

    const response = await postCallback(app, remoteResult());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, deduped: false });
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledOnce();
  });

  it('persists a valid Commander Directive as the terminal Attempt result', async () => {
    mocks.store.getById.mockResolvedValue(commanderAttempt());

    const response = await postCallback(app, commanderResult());

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        runId,
        leaseOwner,
        leaseGeneration: 0,
        result: expect.objectContaining({
        status: 'completed',
        decision: expect.objectContaining({
          schema: 'commander-directive/v1',
          run_id: runId,
          event_cursor: 5,
        }),
        }),
      }),
    );
    const proposalCalls = mocks.pool.query.mock.calls.filter(([sql]) => (
      sql.includes('commander.directive_proposed')
    ));
    expect(proposalCalls).toHaveLength(1);
    expect(JSON.parse(proposalCalls[0][1][3])).toMatchObject({
      attempt_id: attemptId,
      directive: {
        schema: 'commander-directive/v1',
        run_id: runId,
        event_cursor: 5,
      },
    });
  });

  it.each([
    [
      'unknown Directive field',
      commanderResult({
        decision: {
          ...commanderResult().decision,
          raw_provider_output: 'must not persist',
        },
      }),
    ],
    [
      'foreign Run identity',
      commanderResult({
        decision: {
          ...commanderResult().decision,
          run_id: '44444444-4444-4444-8444-444444444444',
        },
      }),
    ],
    [
      'mismatched bundle cursor',
      commanderResult({
        decision: {
          ...commanderResult().decision,
          event_cursor: 4,
        },
      }),
    ],
  ])('rejects Commander callback with %s before persistence', async (_name, body) => {
    mocks.store.getById.mockResolvedValue(commanderAttempt());

    const response = await postCallback(app, body);

    expect(response.status).toBe(400);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('接受已确认 Fleet Worker receipt 的 bounded credential callback', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());

    const response = await postCallback(app, fleetResult({
      credential_copy_mutated: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId,
        runId,
        leaseOwner,
        leaseGeneration: 0,
        result: expect.objectContaining({
        provider_metadata: expect.objectContaining({
          credential_ref: credentialRef,
          credential_copy_mutated: true,
        }),
        }),
      }),
    );
  });

  it.each([
    ['missing credential ref', { credential_ref: undefined }],
    ['invalid credential ref', { credential_ref: 'not-a-uuid' }],
    ['non-boolean mutation evidence', { credential_copy_mutated: 'false' }],
    ['provider credential field', { access_token: 'must-not-persist' }],
  ])('拒绝 Fleet Codex callback 的 %s', async (_case, metadata) => {
    mocks.store.getById.mockResolvedValue(fleetAttempt());

    const response = await postCallback(app, fleetResult(metadata));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('credential_callback_invalid');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('拒绝 dedicated canary contract 缺少 CANARY_OK 的 completed callback', async () => {
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      role: 'reporter',
      task_bundle: {
        ...attempt.task_bundle,
        expected_output: 'harness-result/canary-v1',
      },
    });

    const response = await postCallback(app, {
      ...validResult,
      decision: null,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/CANARY_OK/);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it.each([
    [
      'requested machine',
      remoteAttempt({ requested_machine_id: 'xian-mac-m1' }),
      remoteResult(),
    ],
    [
      'actual machine',
      remoteAttempt({ actual_machine_id: 'xian-mac-m1' }),
      remoteResult(),
    ],
  ])('拒绝 callback machine_id 与 %s receipt 不一致', async (_label, receipt, body) => {
    mocks.store.getById.mockResolvedValue(receipt);

    const response = await postCallback(app, body);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('machine_attestation_mismatch');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it.each([
    [
      'copied from another attempt',
      signMachineAttestation({
        secret: fleetSecret,
        attemptId: '33333333-3333-4333-8333-333333333333',
        machineId: remoteMachineId,
        jobId: remoteJobId,
      }),
    ],
    ['invalid', '0'.repeat(64)],
  ])('拒绝 %s machine attestation', async (_label, machineAttestation) => {
    mocks.store.getById.mockResolvedValue(remoteAttempt());

    const response = await postCallback(app, remoteResult({
      machine_attestation: machineAttestation,
    }));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('machine_attestation_mismatch');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('local receipt 无 remote attestation 时仍可完成 callback', async () => {
    mocks.store.getById.mockResolvedValue(attempt);

    const response = await postCallback(app);

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledOnce();
  });

  it('launch receipt 尚未确认时拒绝 callback，避免远端先回调绕过验签', async () => {
    mocks.store.getById.mockResolvedValue({
      ...attempt,
      requested_machine_id: remoteMachineId,
      actual_machine_id: null,
      execution_transport: null,
      remote_job_id: null,
      machine_attestation_status: null,
    });

    const response = await postCallback(app, remoteResult());

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('launch_receipt_unconfirmed');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('remote receipt 无 machine attestation 时拒绝 callback', async () => {
    mocks.store.getById.mockResolvedValue(remoteAttempt());

    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('machine_attestation_mismatch');
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('重复的 verified xian callback 保持幂等', async () => {
    const runningAttempt = remoteAttempt();
    const completedAttempt = {
      ...runningAttempt,
      status: 'completed',
      result: remoteResult(),
    };
    mocks.store.getById
      .mockReset()
      .mockResolvedValueOnce(runningAttempt)
      .mockResolvedValueOnce(completedAttempt)
      .mockResolvedValueOnce(completedAttempt);

    const first = await postCallback(app, remoteResult());
    const second = await postCallback(app, remoteResult());

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, deduped: false });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, deduped: true });
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
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
    expect(mocks.pool.query.mock.calls.some(([sql]) => /verdict:reviewer/.test(sql))).toBe(false);
  });

  it('终态 callback 的 lease_owner 不匹配时返回 409', async () => {
    const response = await postCallback(app, validResult, callbackToken, 'other-owner');
    expect(response.status).toBe(409);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('R11: 缺失或非法 lease generation 时拒绝 callback', async () => {
    const missing = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .set('Authorization', `Bearer ${callbackToken}`)
      .set('X-Harness-Lease-Owner', leaseOwner)
      .send(validResult);
    const malformed = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .set('Authorization', `Bearer ${callbackToken}`)
      .set('X-Harness-Lease-Owner', leaseOwner)
      .set('X-Harness-Lease-Generation', 'generation-zero')
      .send(validResult);

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('R11: 旧 lease generation callback 返回 409 且不写终态', async () => {
    const response = await postCallback(app, validResult, callbackToken, leaseOwner, 1);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/generation/i);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('认证后发生换租时拒绝旧 worker，且不得追加 evaluator verdict', async () => {
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
      attempt: null,
      deduped: false,
      conflict: 'lease_owner_mismatch',
    });
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
    expect(verdictCall[0]).toMatch(/action='verdict:evaluate'/);
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
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
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
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
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

  it('generator-fix blocked 只由标准 callback 供收敛回放，不得伪造成功 SHA verdict', async () => {
    const triggerSha = 'a'.repeat(40);
    const advancedSha = 'b'.repeat(40);
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
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
    expect(callbackCalls).toHaveLength(0);
    expect(app.get('kernelPrHeadResolver')).not.toHaveBeenCalled();
  });

  it('generator-fix needs_context 不得写 no-progress callback verdict', async () => {
    mocks.store.getById.mockResolvedValue({ ...attempt, role: 'generator' });
    mocks.store.recordCallbackTerminal.mockReset().mockResolvedValue({
      attempt: { ...attempt, role: 'generator', status: 'needs_context' },
      deduped: false,
    });

    const response = await postCallback(app, {
      ...validResult,
      status: 'needs_context',
      summary: 'Owner answer required.',
      artifacts: [],
      checks: [],
      decision: { outcome: 'needs_context', reason: 'Choose the release policy.' },
    });

    expect(response.status).toBe(200);
    expect(mocks.pool.query.mock.calls.some(([sql]) => (
      sql.includes('verdict:generator-fix-callback')
    ))).toBe(false);
  });

  it('跨角色/attempt session 复用冲突返回 409，且不完成 attempt', async () => {
    mocks.store.assertFreshRoleSession.mockRejectedValueOnce(new Error('role_session_reuse'));
    const response = await postCallback(app);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/role_session_reuse/);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  it('拒绝 callback 冒充另一个 provider', async () => {
    const response = await postCallback(app, {
        ...validResult,
        provider_metadata: { provider: 'claude', session_id: 'session-x' },
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/provider_mismatch/);
    expect(mocks.store.recordCallbackTerminal).not.toHaveBeenCalled();
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

  it('failed result 走统一 callback 终态事务，不伪装为 completed', async () => {
    const response = await postCallback(app, {
        ...validResult,
        status: 'failed',
        summary: 'provider process failed',
        decision: null,
        error: { code: 'provider_exit', message: 'exit 1' },
      });

    expect(response.status).toBe(200);
    expect(mocks.store.recordCallbackTerminal).toHaveBeenCalledWith({
      attemptId,
      runId,
      leaseOwner,
      leaseGeneration: 0,
      result: expect.objectContaining({
        status: 'failed',
        failure_class: 'runner_failure',
        error: { code: 'provider_exit', message: 'exit 1' },
      }),
    });
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
