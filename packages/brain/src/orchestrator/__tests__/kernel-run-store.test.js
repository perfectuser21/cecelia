import { describe, expect, it, vi } from 'vitest';
import {
  activateQueuedKernelTask,
  createKernelRun,
  finalizeKernelRun,
  loadActiveKernelRun,
  loadKernelRunById,
  patchLegacyKernelRunByInitiative,
  patchKernelRunById,
  persistKernelRunPhase,
  reconcileKernelTaskTerminal,
  requeueKernelRunLaunchDeferred,
  syncTaskPayloadFromKernelRun,
} from '../kernel-run-store.js';

// 任务 281aa798：远程点火撞跑场机 429/超时 → run 记失败但任务回 queued（不终态），带延后计数。
function deferPool({ taskStatus = 'in_progress', deferCount = 0, runPhase = 'planning' } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (/FROM tasks/.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111', status: taskStatus, payload: { kernel_launch_defer_count: deferCount } }] };
      }
      if (/FROM initiative_runs/.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: [{ id: '33333333-3333-4333-8333-333333333333', current_task_id: '11111111-1111-4111-8111-111111111111', phase: runPhase }] };
      }
      if (/UPDATE initiative_runs/.test(sql)) return { rows: [], rowCount: 1 };
      if (/UPDATE tasks/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) }, client, calls };
}

describe('requeueKernelRunLaunchDeferred 已退役', () => {
  it('禁止回队且不触及任何旧任务或run',async()=>{
    const {pool,calls}=deferPool();
    await expect(requeueKernelRunLaunchDeferred(pool,{runId:'old',expectedTaskId:'old'})).rejects.toMatchObject({code:'kernel_runtime_retired'});
    expect(pool.connect).not.toHaveBeenCalled();expect(calls).toEqual([]);
  });
  const T = '11111111-1111-4111-8111-111111111111';
  const R = '33333333-3333-4333-8333-333333333333';

  // 2026-09-24 22:10 实证：两条 run 各跑 5–6 小时占满 MMV 双槽，第三条任务每 2 分钟 tick 撞一次
  // 429 deferred；默认上限 10 次 = 20 分钟就被判终态，远小于一条 run 的时长。上限须按"等一整轮
  // run"量级（300 次 ≈ 10 小时）设默认。

});

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const INITIATIVE_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const RECEIPT_ID = '44444444-4444-4444-8444-444444444444';
const PREDECESSOR_RUN_ID = '55555555-5555-4555-8555-555555555555';
// Session Controller ownership（sprint 08131104）：createKernelRun 现要求非空 controllerSessionId。
const CONTROLLER_SESSION_ID = '66666666-6666-4666-8666-666666666666';
const CONTROLLER_LEASE_DEFAULT_SECONDS = 1800;

const VALID_INPUT = Object.freeze({
  taskId: TASK_ID,
  initiativeId: INITIATIVE_ID,
  phase: 'planning',
  journeyId: null,
  abilityId: null,
  host: 'kernel-v1',
  deadlineHours: 8,
  createdSource: 'kernel_dispatch',
});

function transactionPool({
  task = {
    id: TASK_ID,
    task_type: 'harness_initiative',
    status: 'in_progress',
    payload: { initiative_id: INITIATIVE_ID, routing_receipt_id: RECEIPT_ID },
    // 重锚定（任务 d9c405e2）对 metadata===undefined fail-loud，生产 SELECT 必须取该列。
    metadata: {},
  },
  receipt = {
    id: RECEIPT_ID,
    task_id: TASK_ID,
    work_kind: 'coding_mutation',
    change_kind: 'new_capability',
    pipeline: 'harness',
    canonical_task_type: 'harness_initiative',
    default_execution_profile: 'new-capability-v1',
    impact_contract_required: true,
    repo: 'cecelia',
    map_scope: ['cap-router'],
    map_scope_validation_version: 'active-business-node-v1',
    has_v2_run: false,
    evidence: { base_sha: 'a'.repeat(40) },
    superseded: false,
  },
  activeRun = null,
  predecessorRun = null,
} = {}) {
  const order = [];
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN') {
        order.push('BEGIN');
        return { rows: [] };
      }
      if (sql === 'COMMIT') {
        order.push('COMMIT');
        return { rows: [] };
      }
      if (sql === 'ROLLBACK') {
        order.push('ROLLBACK');
        return { rows: [] };
      }
      if (/pg_advisory_xact_lock/.test(sql)) {
        order.push('advisory-lock');
        return { rows: [] };
      }
      if (/FROM tasks/.test(sql) && /FOR UPDATE/.test(sql)) {
        order.push('task-lock');
        return { rows: task ? [task] : [] };
      }
      if (/FROM planner_recovery_receipts receipt/.test(sql)) {
        return { rows: [] };
      }
      if (/FROM initiative_runs predecessor/.test(sql)) {
        order.push('predecessor-run');
        return { rows: predecessorRun ? [predecessorRun] : [] };
      }
      if (/FROM work_routing_receipts receipt/.test(sql)) {
        order.push('routing-receipt');
        return { rows: receipt ? [receipt] : [] };
      }
      if (/FROM initiative_runs/.test(sql)) {
        order.push('active-run');
        return { rows: activeRun ? [activeRun] : [] };
      }
      if (/INSERT INTO initiative_runs/.test(sql)) {
        order.push('insert-run');
        return {
          rows: [{
            id: RUN_ID,
            initiative_id: INITIATIVE_ID,
            current_task_id: TASK_ID,
            phase: 'planning',
            created_source: 'kernel_dispatch',
          }],
        };
      }
      if (/INSERT INTO kernel_controller_sessions/.test(sql)) {
        order.push('insert-controller');
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE kernel_controller_sessions/.test(sql)) {
        order.push('bind-controller');
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE tasks[\s\S]+status = 'queued'/.test(sql)) {
        order.push('reopen-task');
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO cecelia_events/.test(sql)) {
        order.push('routing-event');
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
    release: vi.fn(() => order.push('release')),
  };
  return {
    pool: { connect: vi.fn(async () => client) },
    client,
    calls,
    order,
  };
}

function createRun(harness, input = VALID_INPUT, deps = {}) {
  return createKernelRun(harness.pool, input, {
    ensureMapImpactPreflight: vi.fn(async () => ({
      contract: { id: 'impact-1', status: 'active' },
    })),
    controllerSessionIdFactory: () => CONTROLLER_SESSION_ID,
    ...deps,
  });
}

function finalizationPool({
  run = {
    id: RUN_ID,
    current_task_id: TASK_ID,
    phase: 'generate',
  },
  task = {
    id: TASK_ID,
    status: 'in_progress',
  },
  failTaskWrite = false,
  activeAttempts = [],
} = {}) {
  const order = [];
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN') {
        order.push('BEGIN');
        return { rows: [] };
      }
      if (sql === 'COMMIT') {
        order.push('COMMIT');
        return { rows: [] };
      }
      if (sql === 'ROLLBACK') {
        order.push('ROLLBACK');
        return { rows: [] };
      }
      if (/FROM initiative_runs/.test(sql) && /FOR UPDATE/.test(sql)) {
        order.push('run-lock');
        return { rows: run ? [run] : [] };
      }
      if (/FROM tasks/.test(sql) && /FOR UPDATE/.test(sql)) {
        order.push('task-lock');
        return { rows: task ? [task] : [] };
      }
      if (/FROM harness_attempts/.test(sql) && /FOR UPDATE/.test(sql)) {
        order.push('attempt-lock');
        return { rows: activeAttempts };
      }
      if (/UPDATE initiative_runs/.test(sql)) {
        order.push('run-update');
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE tasks/.test(sql)) {
        order.push('task-update');
        if (failTaskWrite) throw new Error('task write failed');
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE harness_attempts/.test(sql)) {
        order.push('attempt-terminalize');
        return { rows: activeAttempts, rowCount: activeAttempts.length };
      }
      if (/INSERT INTO orchestrator_decision_log/.test(sql)) {
        order.push('terminal-event');
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
    release: vi.fn(() => order.push('release')),
  };
  return {
    pool: { connect: vi.fn(async () => client) },
    client,
    calls,
    order,
  };
}

function exactPatchPool({ task, activeAttempts = [] } = {}) {
  const harness = finalizationPool({ task, activeAttempts });
  return {
    ...harness,
    pool: {
      query: vi.fn(async () => ({
        rows: [{
          id: RUN_ID,
          initiative_id: INITIATIVE_ID,
          current_task_id: TASK_ID,
          phase: 'planning',
          orchestrator_version: 'v2',
        }],
      })),
      connect: harness.pool.connect,
    },
  };
}

describe('Kernel run store creation authority', () => {

  it('loads one v2 run only by primary key', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: RUN_ID }] }));

    const result = await loadKernelRunById({ query }, RUN_ID);

    expect(result).toEqual({ id: RUN_ID });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE id\s*=\s*\$1/i);
    expect(sql).toContain("orchestrator_version = 'v2'");
    expect(sql).toContain('commander_mode');
    expect(sql).toContain('planner_recovery_receipt_id');
    expect(sql).not.toMatch(/initiative_id\s*=\s*\$1/i);
    expect(params).toEqual([RUN_ID]);
  });

  it('loads an active run only by current_task_id', async () => {
    const query = vi.fn(async () => ({ rows: [] }));

    await loadActiveKernelRun({ query }, TASK_ID);

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('current_task_id = $1');
    expect(sql).toContain('commander_mode');
    expect(sql).toContain('impact_contract_policy');
    expect(sql).toContain('map_recovery_contract_id');
    expect(sql).not.toMatch(/OR\s+initiative_id/i);
    expect(params).toEqual([TASK_ID]);
  });

  it.each([
    { task: null, label: 'missing' },
    {
      task: {
        id: TASK_ID,
        task_type: 'dev',
        status: 'in_progress',
        payload: {},
      },
      label: 'wrong type',
    },
    {
      task: {
        id: TASK_ID,
        task_type: 'harness_initiative',
        status: 'failed',
        payload: {},
      },
      label: 'terminal',
    },
  ])('retired creation rejects every task state before SQL: $label', async ({ task }) => {
    const harness = transactionPool({task});
    await expect(createRun(harness)).rejects.toMatchObject({code:'kernel_runtime_retired'});
    expect(harness.order).toEqual([]);
  });

});

describe('syncTaskPayloadFromKernelRun', () => {
  it('created 带新 base_sha 时覆写内存 task.payload 的 base_sha 与 routing_receipt_id', () => {
    const task = { id: 't', payload: { base_sha: 'a'.repeat(40), routing_receipt_id: 'r1', repo: 'cecelia' } };
    const out = syncTaskPayloadFromKernelRun(task, { created: true, base_sha: 'b'.repeat(40), routing_receipt_id: 'r2' });
    expect(out).toBe(task);
    expect(task.payload).toEqual({ base_sha: 'b'.repeat(40), routing_receipt_id: 'r2', repo: 'cecelia' });
  });

  it('created 无 base_sha（null/缺省）时 payload 原样不动', () => {
    const payload = { base_sha: 'a'.repeat(40), routing_receipt_id: 'r1' };
    const task = { id: 't', payload };
    syncTaskPayloadFromKernelRun(task, { created: true, run: {} });
    syncTaskPayloadFromKernelRun(task, { created: true, base_sha: null, routing_receipt_id: null });
    expect(task.payload).toBe(payload);
  });

  it('收据 id 没变却换了 base_sha 时告警（非快进漂移，DB payload 不会被 reanchor 更新）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = { id: 'task-drift', payload: { base_sha: 'a'.repeat(40), routing_receipt_id: 'r1' } };
    syncTaskPayloadFromKernelRun(task, { created: true, base_sha: 'b'.repeat(40), routing_receipt_id: 'r1' });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('task-drift');
    expect(message).toContain('a'.repeat(40));
    expect(message).toContain('r1');
    warn.mockRestore();
  });

  it('快进场景（收据 id 一并换新）不告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = { id: 'task-ff', payload: { base_sha: 'a'.repeat(40), routing_receipt_id: 'r1' } };
    syncTaskPayloadFromKernelRun(task, { created: true, base_sha: 'b'.repeat(40), routing_receipt_id: 'r2' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('源码哨兵：reanchor 写的 payload 字段集 ↔ 回流函数', () => {
  // 重锚定改 DB、回流函数改内存，两边字段集必须同进同退：reanchor 以后多写一个 payload
  // 字段而回流没跟上，就又是一次"改账不改跑场"。这条哨兵让那种漏改直接红。
  it('reanchor UPDATE tasks SET payload 的每个字段都出现在 syncTaskPayloadFromKernelRun 函数体内', async () => {
    const { readFile } = await import('node:fs/promises');
    const reanchorSrc = await readFile(
      new URL('../preflight/base-sha-reanchor.js', import.meta.url),
      'utf8',
    );
    const updateIdx = reanchorSrc.indexOf('UPDATE tasks');
    expect(updateIdx).toBeGreaterThan(-1);
    const blockEnd = reanchorSrc.indexOf('\n  );', updateIdx);
    const updateBlock = reanchorSrc.slice(
      updateIdx,
      blockEnd > -1 ? blockEnd : updateIdx + 2000,
    );
    // 第一个 JSON.stringify 即 $2（payload 合并对象）；$3 是 metadata，不在回流职责内。
    const payloadLiteral = updateBlock.match(/JSON\.stringify\(\{([^}]*)\}\)/);
    expect(payloadLiteral).not.toBeNull();
    const fields = [...payloadLiteral[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)]
      .map((match) => match[1]);
    expect(fields).toEqual(expect.arrayContaining(['routing_receipt_id', 'base_sha']));

    const storeSrc = await readFile(new URL('../kernel-run-store.js', import.meta.url), 'utf8');
    const fnIdx = storeSrc.indexOf('export function syncTaskPayloadFromKernelRun');
    expect(fnIdx).toBeGreaterThan(-1);
    const fnBody = storeSrc.slice(fnIdx, storeSrc.indexOf('\n}', fnIdx));
    for (const field of fields) {
      expect(fnBody).toContain(field);
    }
  });
});

describe('Legacy run mutation serialization', () => {
  it('holds an initiative advisory lock through candidate resolution and exact patch', async () => {
    const calls = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        calls.push({ sql, params });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
        if (/SELECT id\s+FROM initiative_runs/.test(sql)) {
          return { rows: [{ id: RUN_ID }] };
        }
        if (/FROM initiative_runs/.test(sql) && !/FOR UPDATE/.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              initiative_id: INITIATIVE_ID,
              current_task_id: TASK_ID,
              phase: 'planning',
            }],
          };
        }
        if (/FROM tasks/.test(sql) && /FOR UPDATE/.test(sql)) {
          return { rows: [{ id: TASK_ID, status: 'in_progress' }] };
        }
        if (/FROM initiative_runs/.test(sql) && /FOR UPDATE/.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              current_task_id: TASK_ID,
              phase: 'planning',
            }],
          };
        }
        if (/UPDATE initiative_runs/.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              initiative_id: INITIATIVE_ID,
              current_task_id: TASK_ID,
              phase: 'evaluate',
            }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO cecelia_events/.test(sql)) return { rows: [], rowCount: 1 };
        throw new Error(`unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    const result = await patchLegacyKernelRunByInitiative(pool, {
      rawId: INITIATIVE_ID,
      patch: { phase: 'evaluate' },
    });

    expect(result).toMatchObject({
      candidateCount: 1,
      run: { id: RUN_ID, phase: 'evaluate' },
    });
    const lockIndex = calls.findIndex(({ sql }) => /pg_advisory_xact_lock/.test(sql));
    const candidateIndex = calls.findIndex(({ sql }) => /SELECT id\s+FROM initiative_runs/.test(sql));
    const updateIndex = calls.findIndex(({ sql }) => /UPDATE initiative_runs/.test(sql));
    const commitIndex = calls.findIndex(({ sql }) => sql === 'COMMIT');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(candidateIndex).toBeGreaterThan(lockIndex);
    expect(updateIndex).toBeGreaterThan(candidateIndex);
    expect(commitIndex).toBeGreaterThan(updateIndex);
    expect(calls[lockIndex].params).toEqual([`relay-initiative:${INITIATIVE_ID}`]);
  });

  it('fails closed under the same advisory lock when history is ambiguous', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (/SELECT id\s+FROM initiative_runs/.test(sql)) {
          return { rows: [{ id: RUN_ID }, { id: INITIATIVE_ID }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const result = await patchLegacyKernelRunByInitiative(
      { connect: vi.fn(async () => client) },
      { rawId: INITIATIVE_ID, patch: { phase: 'evaluate' } },
    );

    expect(result).toEqual({ candidateCount: 2, run: null });
    expect(client.query.mock.calls.some(([sql]) => /UPDATE initiative_runs/.test(sql))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});

describe('Kernel run/task terminalization authority', () => {
  it('在同一终态事务内完成 repair gap 收口，失败则整体回滚', async () => {
    const harness = finalizationPool();
    const afterTaskFinalized = vi.fn(async (client, context) => {
      expect(client).toBe(harness.client);
      expect(context).toEqual({ runId: RUN_ID, taskId: TASK_ID, outcome: 'done' });
      harness.order.push('repair-gap-resolution');
    });

    await finalizeKernelRun(harness.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'done',
      afterTaskFinalized,
    });

    expect(afterTaskFinalized).toHaveBeenCalledOnce();
    expect(harness.order.indexOf('task-update')).toBeLessThan(
      harness.order.indexOf('repair-gap-resolution'),
    );
    expect(harness.order.indexOf('repair-gap-resolution')).toBeLessThan(
      harness.order.indexOf('COMMIT'),
    );

    const rollbackHarness = finalizationPool();
    await expect(finalizeKernelRun(rollbackHarness.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'done',
      afterTaskFinalized: vi.fn(async () => { throw new Error('gap resolution failed'); }),
    })).rejects.toThrow('gap resolution failed');
    expect(rollbackHarness.order).toContain('ROLLBACK');
    expect(rollbackHarness.order).not.toContain('COMMIT');
  });

  it('closes active attempts under task-run-attempt lock order', async () => {
    const attempt = {
      id: '44444444-4444-4444-8444-444444444444',
      run_id: RUN_ID,
      status: 'running',
    };
    const harness = finalizationPool({ activeAttempts: [attempt] });

    const result = await finalizeKernelRun(harness.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
      reason: 'automation_deadline_exceeded',
    });

    expect(result.attemptsTerminalized).toBe(1);
    expect(harness.order).toEqual([
      'BEGIN',
      'task-lock',
      'run-lock',
      'attempt-lock',
      'run-update',
      'task-update',
      'attempt-terminalize',
      'terminal-event',
      'COMMIT',
      'release',
    ]);
    const terminalize = harness.calls.find(
      ({ sql }) => /UPDATE harness_attempts/.test(sql),
    );
    expect(terminalize.sql).toMatch(/status\s*=\s*'cancelled'/i);
    expect(terminalize.sql).toMatch(/error_code\s*=\s*'parent_run_terminal'/i);
    expect(terminalize.sql).toMatch(/lease_owner\s*=\s*NULL/i);
    expect(terminalize.sql).toMatch(/lease_expires_at\s*=\s*NULL/i);
  });

  it('fails the run and parent task with one terminal event in one transaction', async () => {
    const harness = finalizationPool();

    const result = await finalizeKernelRun(harness.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
      reason: 'automation_deadline_exceeded',
    });

    expect(result).toEqual({
      changed: true,
      outcome: 'failed',
      runId: RUN_ID,
      taskId: TASK_ID,
      attemptsTerminalized: 0,
    });
    const runUpdate = harness.calls.find(({ sql }) => /UPDATE initiative_runs/.test(sql));
    const taskUpdate = harness.calls.find(({ sql }) => /UPDATE tasks/.test(sql));
    const terminalEvent = harness.calls.find(
      ({ sql }) => /INSERT INTO orchestrator_decision_log/.test(sql),
    );
    expect(runUpdate.sql).toMatch(/completed_at\s*=\s*COALESCE\(completed_at,\s*NOW\(\)\)/);
    expect(taskUpdate.sql).toMatch(/completed_at\s*=\s*COALESCE\(completed_at,\s*NOW\(\)\)/);
    expect(taskUpdate.sql).toContain('status = $2::varchar');
    expect(taskUpdate.sql).toContain("WHEN $2::text = 'failed'");
    expect(terminalEvent.sql).toContain("'effect:run_terminal'");
    expect(terminalEvent.params[3]).toContain('automation_deadline_exceeded');
    expect(harness.order).toEqual([
      'BEGIN',
      'task-lock',
      'run-lock',
      'attempt-lock',
      'run-update',
      'task-update',
      'terminal-event',
      'COMMIT',
      'release',
    ]);
  });

  it('rolls back the run update when the task write fails', async () => {
    const harness = finalizationPool({ failTaskWrite: true });

    await expect(finalizeKernelRun(harness.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
      reason: 'automation_deadline_exceeded',
    })).rejects.toThrow('task write failed');

    expect(harness.order).toEqual([
      'BEGIN',
      'task-lock',
      'run-lock',
      'attempt-lock',
      'run-update',
      'task-update',
      'ROLLBACK',
      'release',
    ]);
  });

  it('rejects a conflicting terminal outcome without updates', async () => {
    const harness = finalizationPool({
      run: {
        id: RUN_ID,
        current_task_id: TASK_ID,
        phase: 'failed',
      },
      task: {
        id: TASK_ID,
        status: 'failed',
      },
    });

    await expect(finalizeKernelRun(harness.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'done',
    })).rejects.toThrow('Kernel terminal outcome conflict: failed/done');
    expect(harness.order).toEqual([
      'BEGIN',
      'task-lock',
      'run-lock',
      'ROLLBACK',
      'release',
    ]);
  });

  it('repairs the parent task idempotently for the same run outcome without a second event', async () => {
    const harness = finalizationPool({
      run: {
        id: RUN_ID,
        current_task_id: TASK_ID,
        phase: 'failed',
      },
    });

    const result = await finalizeKernelRun(harness.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
      reason: 'terminal_run_reconciliation',
    });

    expect(result.changed).toBe(false);
    expect(harness.order).toEqual([
      'BEGIN',
      'task-lock',
      'run-lock',
      'attempt-lock',
      'task-update',
      'COMMIT',
      'release',
    ]);
  });

  it('rejects a run/task identity mismatch', async () => {
    const harness = finalizationPool({
      run: {
        id: RUN_ID,
        current_task_id: INITIATIVE_ID,
        phase: 'generate',
      },
    });

    await expect(finalizeKernelRun(harness.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
    })).rejects.toThrow(`Kernel run/task identity mismatch: ${RUN_ID}/${TASK_ID}`);
    expect(harness.order).toEqual([
      'BEGIN',
      'task-lock',
      'run-lock',
      'ROLLBACK',
      'release',
    ]);
  });
});

describe('Kernel exact non-terminal patch authority', () => {
  it('terminal exact patch closes active attempts in the same transaction', async () => {
    const harness = exactPatchPool({
      activeAttempts: [{
        id: '44444444-4444-4444-8444-444444444444',
        run_id: RUN_ID,
        status: 'running',
      }],
    });

    await patchKernelRunById(harness.pool, {
      runId: RUN_ID,
      phase: 'failed',
      failureReason: 'exact_patch_terminal',
    });

    expect(harness.order).toEqual([
      'BEGIN',
      'task-lock',
      'run-lock',
      'attempt-lock',
      'run-update',
      'task-update',
      'attempt-terminalize',
      'terminal-event',
      'COMMIT',
      'release',
    ]);
  });

  it('rejects an active phase write when the parent task is missing', async () => {
    const harness = exactPatchPool({ task: null });

    await expect(patchKernelRunById(harness.pool, {
      runId: RUN_ID,
      phase: 'generate',
    })).rejects.toThrow(`Kernel run parent task missing: ${RUN_ID}`);
    expect(harness.order).toContain('ROLLBACK');
    expect(harness.order).not.toContain('run-update');
  });

  it('rejects an active phase write when the parent task is terminal', async () => {
    const harness = exactPatchPool({
      task: { id: TASK_ID, status: 'completed' },
    });

    await expect(patchKernelRunById(harness.pool, {
      runId: RUN_ID,
      phase: 'generate',
    })).rejects.toThrow('Kernel task is terminal: completed');
    expect(harness.order).toContain('ROLLBACK');
    expect(harness.order).not.toContain('run-update');
  });

  it.each(['cancelled', 'canceled'])(
    'rejects active progress for a %s task but may close its run as failed without rewriting cancellation',
    async (status) => {
      const activeHarness = exactPatchPool({
        task: { id: TASK_ID, status },
      });
      await expect(patchKernelRunById(activeHarness.pool, {
        runId: RUN_ID,
        phase: 'generate',
      })).rejects.toThrow(`Kernel task is terminal: ${status}`);

      const terminalHarness = exactPatchPool({
        task: { id: TASK_ID, status },
      });
      await patchKernelRunById(terminalHarness.pool, {
        runId: RUN_ID,
        phase: 'failed',
        failureReason: 'task_cancelled',
      });
      expect(terminalHarness.order).toContain('run-update');
      expect(terminalHarness.order).not.toContain('task-update');
      expect(terminalHarness.order).toContain('COMMIT');
    },
  );
});

describe('Kernel terminal reconciliation authority', () => {
  it('refuses a stale task-status repair before locking or changing the run', async () => {
    const harness = exactPatchPool({
      task: { id: TASK_ID, status: 'paused' },
    });

    await expect(finalizeKernelRun(harness.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      expectedTaskStatus: 'queued',
      outcome: 'failed',
      reason: 'production_reconciliation',
    })).rejects.toThrow('Kernel task status changed: paused/queued');

    expect(harness.order).toContain('BEGIN');
    expect(harness.order).not.toContain('run-lock');
    expect(harness.order).not.toContain('run-update');
    expect(harness.order).not.toContain('task-update');
    expect(harness.order).toContain('ROLLBACK');
  });

  it('repairs a task only from its latest exactly linked terminal run', async () => {
    const query = vi.fn(async () => ({
      rows: [{
        id: RUN_ID,
        phase: 'failed',
        failure_reason: 'pid_gone',
      }],
    }));
    const finalizeRun = vi.fn(async () => ({
      changed: false,
      outcome: 'failed',
      runId: RUN_ID,
      taskId: TASK_ID,
    }));

    const result = await reconcileKernelTaskTerminal(
      { query },
      TASK_ID,
      { finalizeRun },
    );

    expect(result).toEqual({
      reconciled: true,
      runId: RUN_ID,
      outcome: 'failed',
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('current_task_id = $1');
    expect(sql).not.toMatch(/OR\s+initiative_id/i);
    expect(sql).toContain("phase IN ('done', 'failed')");
    expect(sql).toContain("active.phase NOT IN ('done', 'failed')");
    expect(sql).toContain('completed_at DESC NULLS LAST');
    expect(params).toEqual([TASK_ID]);
    expect(finalizeRun).toHaveBeenCalledWith(
      { query },
      {
        runId: RUN_ID,
        expectedTaskId: TASK_ID,
        requireNoActiveSibling: true,
        outcome: 'failed',
        reason: 'pid_gone',
      },
    );
  });

  it('does not guess when no terminal run is linked to the task', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const finalizeRun = vi.fn();

    const result = await reconcileKernelTaskTerminal(
      { query },
      TASK_ID,
      { finalizeRun },
    );

    expect(result).toEqual({
      reconciled: false,
      reason: 'no_task_linked_terminal_run',
    });
    expect(finalizeRun).not.toHaveBeenCalled();
  });
});

// r17 实证：Kernel 运行中不持久化 run.phase / task.status，只有 finalizeKernelRun
// 写终态。以下两组测试锁死 loop.js/run.js 必须调用的两个独立单语句 UPDATE helper
// （PrepPRD: docs/prd/2026-08-04-kernel-phase-persist-prep-prd.md）。
describe('persistKernelRunPhase', () => {
  it('单条独立 autocommit UPDATE：前进相位写入 + updated_at 刷新', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: RUN_ID, phase: 'gan' }] }));
    const pool = { query };

    const result = await persistKernelRunPhase(pool, RUN_ID, 'gan');

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    // 死锁铁律（PR #4596 教训）：本语句本身不得出现 BEGIN/FOR UPDATE 之类的
    // 显式事务包装或多表联锁。注意这不等于"整个操作无锁"——initiative_runs 上
    // 的 AFTER 触发器会在同一条 UPDATE 隐式打开的事务里另外取
    // pg_advisory_xact_lock（见 kernel-run-store.js 顶部注释的锁序说明），
    // 因此这里不对 SQL 文本做 pg_advisory_xact_lock 的"无锁"假断言
    // （I-1 审查修正：真实的 pg 集成测试覆盖锁序，而不是 SQL 字符串匹配）。
    expect(sql).not.toMatch(/\bBEGIN\b/i);
    expect(sql).not.toMatch(/FOR\s+UPDATE/i);
    expect(sql).toMatch(/UPDATE\s+initiative_runs/i);
    expect(sql).toMatch(/orchestrator_version\s*=\s*'v2'/);
    expect(sql).toMatch(/phase\s+IS\s+DISTINCT\s+FROM\s+\$2/i);
    // 'paused' 必须在排除列表里（I-2 审查修正）：paused 是 needs_context 人审
    // 等待态，被前进相位覆写会让 activateContextResume 的 WHERE phase='paused'
    // 命中 0 行，context-answer 锚点丢失、resume 永久卡死。
    expect(sql).toMatch(/phase\s+NOT\s+IN\s*\(\s*'done'\s*,\s*'failed'\s*,\s*'paused'\s*\)/i);
    expect(sql).toMatch(/updated_at\s*=\s*NOW\(\)/i);
    expect(params).toEqual([RUN_ID, 'gan']);
    expect(result).toEqual({ id: RUN_ID, phase: 'gan' });
  });

  it('已终态或同相位时 WHERE 不命中：返回 null，不抛错', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { query };

    const result = await persistKernelRunPhase(pool, RUN_ID, 'gan');

    expect(result).toBeNull();
  });

  it('当前行是 paused（needs_context 人审等待）时 WHERE 不命中：不覆写、不丢锚点', async () => {
    // mock 层面代表"当前行 phase='paused'"这一事实——真实 DB 行为由
    // kernel-wiring.pg.integration.test.js 对真实 Postgres 断言。
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { query };

    const result = await persistKernelRunPhase(pool, RUN_ID, 'gan');

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/'paused'/);
    expect(result).toBeNull();
  });

  it('底层 query 失败原样上抛（由调用方 loop.js 决定降级为告警）', async () => {
    const query = vi.fn(async () => { throw new Error('connection refused'); });
    const pool = { query };

    await expect(persistKernelRunPhase(pool, RUN_ID, 'generate'))
      .rejects.toThrow('connection refused');
  });
});

describe('activateQueuedKernelTask', () => {
  it('queued → in_progress：单条 UPDATE WHERE status=queued，补写 started_at', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: TASK_ID }] }));
    const pool = { query };

    const result = await activateQueuedKernelTask(pool, TASK_ID);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/BEGIN|pg_advisory_xact_lock|FOR UPDATE/i);
    expect(sql).toMatch(/UPDATE\s+tasks/i);
    expect(sql).toMatch(/status\s*=\s*'in_progress'/i);
    expect(sql).toMatch(/WHERE\s+id\s*=\s*\$1/i);
    expect(sql).toMatch(/AND\s+status\s*=\s*'queued'/i);
    // I-3 审查修正：isStale（tick-status.js）/ getBlockedTasks（decision.js）
    // 都是 `if (!started_at) return false` / 直接 skip——不补写 started_at，
    // Kernel 任务对这两个巡检永久隐形。用 COALESCE 不硬覆盖，防止 resume 场景
    // 重复推迟起算时间。
    expect(sql).toMatch(/started_at\s*=\s*COALESCE\(\s*started_at\s*,\s*NOW\(\)\s*\)/i);
    expect(sql).toMatch(/updated_at\s*=\s*NOW\(\)/i);
    expect(params).toEqual([TASK_ID]);
    expect(result).toEqual({ id: TASK_ID });
  });

  it('非 queued（已 in_progress/终态）：WHERE 不命中，返回 null，不碰该行', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { query };

    const result = await activateQueuedKernelTask(pool, TASK_ID);

    expect(result).toBeNull();
  });
});
