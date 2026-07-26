import { describe, expect, it, vi } from 'vitest';

import { createAttemptStore } from '../attempt-store.js';

const input = {
  id: '22222222-2222-4222-8222-222222222222',
  runId: '11111111-1111-4111-8111-111111111111',
  hop: 3,
  phase: 'B_contract',
  role: 'reviewer',
  provider: 'auto',
  accountId: null,
  machineId: 'worker-1',
  callbackSecretHash: 'b'.repeat(64),
  bundle: {
    skill: {
      name: 'harness-contract-reviewer',
      version: '9.16.0',
      digest: `sha256:${'a'.repeat(64)}`,
    },
  },
};

function poolWith(...results) {
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? { rows: [], rowCount: 0 })),
  };
}

describe('attempt store', () => {
  it('按 run/hop 幂等创建 attempt，并持久化冻结 Skill 元数据', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'queued' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    const result = await store.createAttempt(input);

    expect(result.id).toBe(input.id);
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO harness_attempts/i);
    expect(sql).toMatch(/ON CONFLICT \(run_id, hop\)/i);
    expect(sql).toMatch(/machine_id,\s*requested_machine_id/i);
    expect(values.slice(7, 9)).toEqual([input.machineId, input.machineId]);
    expect(values).toEqual(expect.arrayContaining([
      input.id,
      input.runId,
      'harness-contract-reviewer',
      '9.16.0',
      `sha256:${'a'.repeat(64)}`,
      'b'.repeat(64),
    ]));
  });

  it('starting/running/heartbeat 都使用 lease owner fencing', async () => {
    const pool = poolWith(
      { rows: [{ id: input.id, status: 'starting' }], rowCount: 1 },
      { rows: [{ id: input.id, status: 'running' }], rowCount: 1 },
      { rows: [{ id: input.id, status: 'running' }], rowCount: 1 },
    );
    const store = createAttemptStore(pool);

    await store.markStarting(input.id, { leaseOwner: 'brain-1', leaseSeconds: 90 });
    await store.markRunning(input.id, { leaseOwner: 'brain-1', providerSessionId: 'session-1', leaseSeconds: 90 });
    await store.heartbeat(input.id, { leaseOwner: 'brain-1', leaseSeconds: 90 });

    expect(pool.query.mock.calls[0][0]).toMatch(/status = 'starting'.*lease_owner =/is);
    expect(pool.query.mock.calls[1][0]).toMatch(/status = 'running'.*provider_session_id/is);
    expect(pool.query.mock.calls[2][0]).toMatch(/lease_owner = \$2.*status IN \('starting','running'\)/is);
  });

  it('watchdog 只能 reclaim 已过期的同一个非终态 attempt', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'starting' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    await store.reclaim(input.id, { leaseOwner: 'watchdog-1', leaseSeconds: 180 });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/lease_expires_at < NOW\(\)/i);
    expect(sql).toMatch(/status IN \('starting','running'\)/i);
    expect(sql).toMatch(/lease_generation\s*=\s*lease_generation\s*\+\s*1/i);
    expect(values).toEqual([input.id, 'watchdog-1', 180]);
  });

  it('launch receipt 只由同一个 lease owner 写入 starting/running attempt', async () => {
    const receipt = {
      leaseOwner: 'brain-1',
      actualMachineId: 'worker-2',
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job-7',
      attestationStatus: 'verified',
    };
    const pool = poolWith({
      rows: [{
        id: input.id,
        actual_machine_id: receipt.actualMachineId,
        execution_transport: receipt.executionTransport,
      }],
      rowCount: 1,
    });
    const store = createAttemptStore(pool);

    const result = await store.recordLaunchReceipt(input.id, receipt);

    expect(result).toMatchObject({
      id: input.id,
      actual_machine_id: receipt.actualMachineId,
      execution_transport: receipt.executionTransport,
    });
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/actual_machine_id\s*=\s*\$3/i);
    expect(sql).toMatch(/execution_transport\s*=\s*\$4/i);
    expect(sql).toMatch(/remote_job_id\s*=\s*\$5/i);
    expect(sql).toMatch(/machine_attestation_status\s*=\s*\$6/i);
    expect(sql).toMatch(/lease_owner\s*=\s*\$2/i);
    expect(sql).toMatch(/status IN \('starting','running'\)/i);
    expect(values).toEqual([
      input.id,
      receipt.leaseOwner,
      receipt.actualMachineId,
      receipt.executionTransport,
      receipt.remoteJobId,
      receipt.attestationStatus,
    ]);
  });

  it('reclaim 后按 lease fencing 原子轮换 callback secret hash', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'starting' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    await store.rotateCallbackSecret(input.id, {
      leaseOwner: 'watchdog-1',
      callbackSecretHash: 'c'.repeat(64),
    });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/callback_secret_hash\s*=\s*\$3/i);
    expect(sql).toMatch(/lease_owner\s*=\s*\$2/i);
    expect(sql).toMatch(/status IN \('starting','running'\)/i);
    expect(values).toEqual([input.id, 'watchdog-1', 'c'.repeat(64)]);
  });

  it('终态写入只接受一次，重复 callback 返回 deduped', async () => {
    const pool = poolWith(
      { rows: [{ id: input.id, status: 'completed' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    );
    const store = createAttemptStore(pool);
    const result = { status: 'completed', summary: 'done' };

    expect(await store.complete(input.id, result, { leaseOwner: 'brain-1' })).toMatchObject({ deduped: false });
    expect(await store.complete(input.id, result, { leaseOwner: 'brain-1' })).toEqual({ attempt: null, deduped: true });
    expect(pool.query.mock.calls[0][0]).toMatch(/status NOT IN \(/i);
    expect(pool.query.mock.calls[0][0]).toMatch(/lease_owner\s*=\s*\$5/i);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/lease_owner\s*=\s*NULL/i);
  });

  it('失败也遵循终态幂等守卫', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'failed' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    const outcome = await store.fail(input.id, { code: 'launch_failed', message: 'boom' });

    expect(outcome.deduped).toBe(false);
    expect(pool.query.mock.calls[0][0]).toMatch(/error_code.*error_message/is);
    expect(pool.query.mock.calls[0][0]).toMatch(/status NOT IN \(/i);
  });

  it('拒绝 proposer session 被 reviewer 复用', async () => {
    const pool = poolWith({
      rows: [{
        id: '33333333-3333-4333-8333-333333333333',
        role: 'proposer',
        provider_session_id: 'same-session',
      }],
    });
    const store = createAttemptStore(pool);

    await expect(store.assertFreshRoleSession({
      runId: input.runId,
      attemptId: input.id,
      role: 'reviewer',
      sessionId: 'same-session',
    })).rejects.toThrow(/role_session_reuse/);
  });

  it('resume 只允许同一个 attempt；同角色的新 attempt 也不能偷用旧 session', async () => {
    const sameAttemptPool = poolWith({
      rows: [{ id: input.id, role: 'reviewer', provider_session_id: 'session-1' }],
    });
    await expect(createAttemptStore(sameAttemptPool).assertFreshRoleSession({
      runId: input.runId,
      attemptId: input.id,
      role: 'reviewer',
      sessionId: 'session-1',
    })).resolves.toBe(true);

    const otherAttemptPool = poolWith({
      rows: [{
        id: '44444444-4444-4444-8444-444444444444',
        role: 'reviewer',
        provider_session_id: 'session-1',
      }],
    });
    await expect(createAttemptStore(otherAttemptPool).assertFreshRoleSession({
      runId: input.runId,
      attemptId: input.id,
      role: 'reviewer',
      sessionId: 'session-1',
    })).rejects.toThrow(/cross_attempt_session_reuse/);
  });

  it('按 id 和 run/hop 读取 attempt', async () => {
    const pool = poolWith(
      { rows: [{ id: input.id }], rowCount: 1 },
      { rows: [{ id: input.id, hop: 3 }], rowCount: 1 },
    );
    const store = createAttemptStore(pool);

    expect(await store.getById(input.id)).toMatchObject({ id: input.id });
    expect(await store.getByRunHop(input.runId, 3)).toMatchObject({ id: input.id, hop: 3 });
  });
});
