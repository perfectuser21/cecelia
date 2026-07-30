import { describe, expect, it, vi } from 'vitest';
import {
  createKernelRun,
  loadActiveKernelRun,
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
    payload: {},
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
});
