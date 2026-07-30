import { describe, expect, it, vi } from 'vitest';
import {
  createKernelRun,
  finalizeKernelRun,
  loadActiveKernelRun,
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
      if (/UPDATE initiative_runs/.test(sql)) {
        order.push('run-update');
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE tasks/.test(sql)) {
        order.push('task-update');
        if (failTaskWrite) throw new Error('task write failed');
        return { rows: [], rowCount: 1 };
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

describe('Kernel run store creation authority', () => {
  it('loads an active run only by current_task_id', async () => {
    const query = vi.fn(async () => ({ rows: [] }));

    await loadActiveKernelRun({ query }, TASK_ID);

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('current_task_id = $1');
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
    expect(insert.params).toEqual([
      INITIATIVE_ID,
      'planning',
      null,
      'kernel-v1',
      8,
      null,
      TASK_ID,
      'kernel_dispatch',
    ]);
    expect(harness.order).toEqual([
      'BEGIN',
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
      'task-lock',
      'ROLLBACK',
      'release',
    ]);
  });
});

describe('Kernel run/task terminalization authority', () => {
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
    });
    const runUpdate = harness.calls.find(({ sql }) => /UPDATE initiative_runs/.test(sql));
    const taskUpdate = harness.calls.find(({ sql }) => /UPDATE tasks/.test(sql));
    const terminalEvent = harness.calls.find(
      ({ sql }) => /INSERT INTO orchestrator_decision_log/.test(sql),
    );
    expect(runUpdate.sql).toMatch(/completed_at\s*=\s*COALESCE\(completed_at,\s*NOW\(\)\)/);
    expect(taskUpdate.sql).toMatch(/completed_at\s*=\s*COALESCE\(completed_at,\s*NOW\(\)\)/);
    expect(terminalEvent.sql).toContain("'effect:run_terminal'");
    expect(terminalEvent.params[3]).toContain('automation_deadline_exceeded');
    expect(harness.order).toEqual([
      'BEGIN',
      'task-lock',
      'run-lock',
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

describe('Kernel terminal reconciliation authority', () => {
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
    expect(sql).toContain('completed_at DESC NULLS LAST');
    expect(params).toEqual([TASK_ID]);
    expect(finalizeRun).toHaveBeenCalledWith(
      { query },
      {
        runId: RUN_ID,
        expectedTaskId: TASK_ID,
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
