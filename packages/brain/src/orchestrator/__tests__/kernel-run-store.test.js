import { describe, expect, it, vi } from 'vitest';
import {
  createKernelRun,
  finalizeKernelRun,
  loadActiveKernelRun,
  loadKernelRunById,
  patchLegacyKernelRunByInitiative,
  patchKernelRunById,
  reconcileKernelTaskTerminal,
} from '../kernel-run-store.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const INITIATIVE_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

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
    payload: { initiative_id: INITIATIVE_ID },
  },
  activeRun = null,
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
    expect(sql).not.toMatch(/OR\s+initiative_id/i);
    expect(params).toEqual([TASK_ID]);
  });

  it('creates a fully identified run under a task row lock', async () => {
    const harness = transactionPool();

    const result = await createKernelRun(harness.pool, VALID_INPUT);

    expect(result).toMatchObject({
      created: true,
      run: {
        id: RUN_ID,
        current_task_id: TASK_ID,
        created_source: 'kernel_dispatch',
      },
    });
    const taskLock = harness.calls.find(({ sql }) => (
      /FROM tasks/.test(sql) && /FOR UPDATE/.test(sql)
    ));
    const insert = harness.calls.find(({ sql }) => /INSERT INTO initiative_runs/.test(sql));
    expect(taskLock).toBeTruthy();
    expect(insert.sql).toContain('current_task_id');
    expect(insert.sql).toContain('created_source');
    expect(insert.sql).toContain('record_trust_status');
    expect(insert.sql).toContain('commander_mode');
    expect(insert.params).toEqual([
      INITIATIVE_ID,
      'planning',
      null,
      'kernel-v1',
      8,
      null,
      TASK_ID,
      'kernel_dispatch',
      'trusted',
      'kernel-only',
    ]);
    expect(harness.order).toEqual([
      'BEGIN',
      'advisory-lock',
      'advisory-lock',
      'task-lock',
      'active-run',
      'insert-run',
      'COMMIT',
      'release',
    ]);
  });

  it('persists an explicit commander mode in the creation transaction', async () => {
    const harness = transactionPool();

    await createKernelRun(harness.pool, {
      ...VALID_INPUT,
      commanderMode: 'hybrid',
    });

    const insert = harness.calls.find(({ sql }) => /INSERT INTO initiative_runs/.test(sql));
    expect(insert.sql).toContain('commander_mode');
    expect(insert.params).toContain('hybrid');
    expect(harness.order).toEqual([
      'BEGIN',
      'advisory-lock',
      'advisory-lock',
      'task-lock',
      'active-run',
      'insert-run',
      'COMMIT',
      'release',
    ]);
  });

  it('returns an existing active run without inserting', async () => {
    const activeRun = {
      id: RUN_ID,
      initiative_id: INITIATIVE_ID,
      current_task_id: TASK_ID,
      phase: 'generate',
      created_source: 'kernel_dispatch',
    };
    const harness = transactionPool({ activeRun });

    const result = await createKernelRun(harness.pool, VALID_INPUT);

    expect(result).toEqual({ created: false, run: activeRun });
    expect(harness.order).toEqual([
      'BEGIN',
      'advisory-lock',
      'advisory-lock',
      'task-lock',
      'active-run',
      'COMMIT',
      'release',
    ]);
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
  ])('rolls back for an ineligible task: $label', async ({ task }) => {
    const harness = transactionPool({ task });

    await expect(createKernelRun(harness.pool, VALID_INPUT))
      .rejects.toThrow(`kernel run task ${TASK_ID} not eligible`);
    expect(harness.order).toEqual([
      'BEGIN',
      'advisory-lock',
      'advisory-lock',
      'task-lock',
      'ROLLBACK',
      'release',
    ]);
  });

  it('rejects an invalid phase or source before opening a transaction', async () => {
    const harness = transactionPool();

    await expect(createKernelRun(harness.pool, {
      ...VALID_INPUT,
      phase: 'done',
    })).rejects.toThrow('invalid Kernel run start phase: done');
    await expect(createKernelRun(harness.pool, {
      ...VALID_INPUT,
      createdSource: 'guessed',
    })).rejects.toThrow('invalid Kernel run created source: guessed');
    expect(harness.pool.connect).not.toHaveBeenCalled();
  });

  it('rejects an invalid commander mode before opening a transaction', async () => {
    const harness = transactionPool();

    await expect(createKernelRun(harness.pool, {
      ...VALID_INPUT,
      commanderMode: 'unsafe-mode',
    })).rejects.toThrow('invalid Kernel run commander mode: unsafe-mode');
    expect(harness.pool.connect).not.toHaveBeenCalled();
  });

  it('rejects a task-to-initiative ownership mismatch under the task lock', async () => {
    const harness = transactionPool({
      task: {
        id: TASK_ID,
        task_type: 'harness_initiative',
        status: 'in_progress',
        payload: { initiative_id: RUN_ID },
      },
    });

    await expect(createKernelRun(harness.pool, VALID_INPUT))
      .rejects.toThrow(
        `kernel run task ${TASK_ID} initiative mismatch: ${INITIATIVE_ID}/${RUN_ID}`,
      );
    expect(harness.order).toEqual([
      'BEGIN',
      'advisory-lock',
      'advisory-lock',
      'task-lock',
      'ROLLBACK',
      'release',
    ]);
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
