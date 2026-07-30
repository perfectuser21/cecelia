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
  it('R8/R12: callback terminal write and one standard event share a transaction', async () => {
    const callbackResult = {
      status: 'blocked',
      summary: 'fleet transport unavailable',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      failure_class: 'infrastructure_blocked',
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'generate',
      role: 'generator',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      result: null,
    };
    const completed = { ...running, status: 'blocked', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [running] })
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
      connect: vi.fn(async () => client),
    };

    await expect(createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    })).resolves.toMatchObject({ attempt: completed, deduped: false });

    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toMatch(/FOR UPDATE/i);
    expect(client.query.mock.calls[2][0]).toMatch(
      /lease_generation.*status NOT IN/is,
    );
    expect(client.query.mock.calls[3][0]).toMatch(
      /verdict:attempt_callback/i,
    );
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('R11: stale callback generation rolls back without terminal or decision writes', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [{
            id: input.id,
            run_id: input.runId,
            status: 'running',
            lease_owner: 'brain-1',
            lease_generation: 4,
          }],
        })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await expect(createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: {
        status: 'completed',
        summary: 'stale',
        artifacts: [],
        provider_metadata: { provider: 'codex' },
      },
    })).resolves.toMatchObject({
      attempt: null,
      deduped: false,
      conflict: 'lease_generation_mismatch',
    });

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/FOR UPDATE/i),
      'ROLLBACK',
    ]);
  });

  it('按 run/hop 幂等创建 attempt，并持久化冻结 Skill 元数据', async () => {
    const pool = poolWith({
      rows: [{
        id: input.id,
        status: 'queued',
        local_container_naming: 'generation-v1',
      }],
      rowCount: 1,
    });
    const store = createAttemptStore(pool);

    const result = await store.createAttempt(input);

    expect(result.id).toBe(input.id);
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO harness_attempts/i);
    expect(sql).not.toMatch(/INSERT INTO harness_run_events/i);
    expect(sql).toMatch(/ON CONFLICT \(run_id, hop\)/i);
    expect(sql).toMatch(/machine_id,\s*requested_machine_id/i);
    expect(sql).toMatch(/requested_machine_id,\s*local_container_naming/i);
    expect(values.slice(7, 9)).toEqual([input.machineId, input.machineId]);
    expect(values).toContain('generation-v1');
    expect(result.local_container_naming).toBe('generation-v1');
    expect(values).toEqual(expect.arrayContaining([
      input.id,
      input.runId,
      'harness-contract-reviewer',
      '9.16.0',
      `sha256:${'a'.repeat(64)}`,
      'b'.repeat(64),
    ]));
  });

  it('并发冲突语句看不到 winner 时用新语句重读现有 attempt', async () => {
    const winner = {
      id: '33333333-3333-4333-8333-333333333333',
      run_id: input.runId,
      hop: input.hop,
      status: 'queued',
    };
    const pool = poolWith(
      { rows: [], rowCount: 0 },
      { rows: [winner], rowCount: 1 },
    );

    await expect(createAttemptStore(pool).createAttempt(input)).resolves.toEqual(winner);

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(run_id, hop\) DO NOTHING/i);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/DO UPDATE/i);
    expect(pool.query.mock.calls[1]).toEqual([
      expect.stringMatching(/SELECT \* FROM harness_attempts WHERE run_id=\$1 AND hop=\$2/i),
      [input.runId, input.hop],
    ]);
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
    for (const [sql] of pool.query.mock.calls) {
      expect(sql).not.toMatch(/INSERT INTO harness_run_events/i);
    }
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
      leaseGeneration: 3,
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
    expect(sql).toMatch(/lease_generation\s*=\s*\$7/i);
    expect(sql).toMatch(/status IN \('starting','running'\)/i);
    expect(values).toEqual([
      input.id,
      receipt.leaseOwner,
      receipt.actualMachineId,
      receipt.executionTransport,
      receipt.remoteJobId,
      receipt.attestationStatus,
      receipt.leaseGeneration,
    ]);
  });

  it('launch receipt requires an explicit non-negative lease generation', async () => {
    const pool = poolWith();
    const store = createAttemptStore(pool);

    await expect(store.recordLaunchReceipt(input.id, {
      leaseOwner: 'brain-1',
      actualMachineId: 'worker-2',
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job-7',
      attestationStatus: 'verified',
    })).rejects.toThrow('recordLaunchReceipt requires leaseGeneration');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('reclaim 后按 lease fencing 原子轮换 callback secret hash', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'starting' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    await store.rotateCallbackSecret(input.id, {
      leaseOwner: 'watchdog-1',
      leaseGeneration: 5,
      callbackSecretHash: 'c'.repeat(64),
    });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/callback_secret_hash\s*=\s*\$3/i);
    expect(sql).toMatch(/lease_owner\s*=\s*\$2/i);
    expect(sql).toMatch(/lease_generation\s*=\s*\$4/i);
    expect(sql).toMatch(/status IN \('starting','running'\)/i);
    expect(values).toEqual([input.id, 'watchdog-1', 'c'.repeat(64), 5]);
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
    expect(pool.query.mock.calls[0][0]).toMatch(/lease_owner\s*=\s*\$6/i);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/lease_owner\s*=\s*NULL/i);
  });

  it('semantic refusal 作为成功终态的规范化 failure class 持久化', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'blocked' }], rowCount: 1 });
    const store = createAttemptStore(pool);
    const result = {
      status: 'blocked',
      summary: 'needs product context',
      failure_class: 'semantic_refusal',
    };

    await expect(
      store.complete(input.id, result, { leaseOwner: 'brain-1' }),
    ).resolves.toMatchObject({ deduped: false });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/failure_class\s*=\s*\$5/i);
    expect(sql).toMatch(/lease_owner\s*=\s*\$6/i);
    expect(values).toEqual([
      input.id,
      'blocked',
      result,
      null,
      'semantic_refusal',
      'brain-1',
    ]);
  });

  it('失败也遵循终态幂等守卫', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'failed' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    const outcome = await store.fail(input.id, {
      code: 'launch_failed',
      message: 'boom',
      failureClass: 'runner_failure',
    });

    expect(outcome.deduped).toBe(false);
    expect(pool.query.mock.calls[0][0]).toMatch(
      /error_code.*error_message.*failure_class/is,
    );
    expect(pool.query.mock.calls[0][1]).toContain('runner_failure');
    expect(pool.query.mock.calls[0][0]).toMatch(/status NOT IN \(/i);
  });

  it('claimed failure optionally fences the exact lease generation', async () => {
    const pool = poolWith({ rows: [{ id: input.id, status: 'failed' }], rowCount: 1 });
    const store = createAttemptStore(pool);

    await store.fail(input.id, {
      code: 'launch_failed',
      message: 'boom',
      failureClass: 'runner_failure',
    }, {
      leaseOwner: 'brain-1',
      leaseGeneration: 4,
    });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/\$6::text IS NULL OR lease_owner = \$6/i);
    expect(sql).toMatch(/\$7::integer IS NULL OR lease_generation = \$7/i);
    expect(values).toEqual([
      input.id,
      'failed',
      'launch_failed',
      'boom',
      'runner_failure',
      'brain-1',
      4,
    ]);
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

  it('按 hop 顺序暴露同 run/role 的终态失败执行目标', async () => {
    const rows = [
      {
        provider: 'codex',
        account_id: 'team3',
        requested_machine_id: 'xian-mac-m4',
      },
      {
        provider: 'codex',
        account_id: 'team5',
        requested_machine_id: 'xian-mac-m1',
      },
    ];
    const pool = poolWith({ rows, rowCount: rows.length });
    const store = createAttemptStore(pool);

    await expect(store.listFailedExecutionTargets(input.runId, 'generator')).resolves.toEqual([
      { provider: 'codex', account: 'team3', machine: 'xian-mac-m4' },
      { provider: 'codex', account: 'team5', machine: 'xian-mac-m1' },
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /WHERE run_id=\$1 AND role=\$2 AND status IN \('failed','cancelled'\)\s+ORDER BY hop/i,
      ),
      [input.runId, 'generator'],
    );
  });

  it('uses bounded SQL to read the latest Commander Attempt', async () => {
    const row = {
      id: input.id,
      run_id: input.runId,
      role: 'commander',
      status: 'completed',
    };
    const pool = poolWith({ rows: [row] });

    await expect(
      createAttemptStore(pool).getLatestCommanderAttempt(input.runId),
    ).resolves.toEqual(row);
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE run_id=\$1\s+AND role='commander'/i);
    expect(sql).toMatch(/ORDER BY hop DESC\s+LIMIT 1/i);
    expect(sql).not.toMatch(/SELECT \*/i);
    expect(sql).not.toMatch(/callback_secret_hash|error_message/i);
    expect(values).toEqual([input.runId]);
  });

  it('reads only one Commander logical-cycle failover lineage', async () => {
    const rows = [{
      id: input.id,
      logical_cycle_id: 'commander-wakeup:5',
      retry_of_attempt_id: null,
      provider: 'codex',
      status: 'failed',
      failure_class: 'infrastructure_blocked',
      error_code: 'provider_unavailable',
    }];
    const pool = poolWith({ rows });

    await expect(createAttemptStore(pool).listCommanderFailoverLineage(
      input.runId,
      'commander-wakeup:5',
    )).resolves.toEqual(rows);
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toMatch(
      /WHERE run_id=\$1\s+AND role='commander'\s+AND logical_cycle_id=\$2/i,
    );
    expect(sql).toMatch(/ORDER BY hop ASC/i);
    expect(sql).not.toMatch(/task_bundle|result|callback_secret_hash|error_message/i);
    expect(values).toEqual([input.runId, 'commander-wakeup:5']);
  });
});
