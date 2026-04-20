import { describe, it, expect, vi } from 'vitest';

function makeMockClient(queryHandler) {
  return {
    query: vi.fn(queryHandler),
    release: vi.fn(),
  };
}

function makeMockPool(client) {
  return {
    connect: vi.fn(async () => client),
  };
}

describe('advanceHarnessInitiatives', () => {
  it('A_contract + contract approved → UPDATE phase=B_task_loop', async () => {
    const updates = [];
    const queryHandler = async (sql, params) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'A_contract', current_task_id: null, contract_id: 'c-1' }] };
      }
      if (sql.includes('FROM initiative_contracts')) {
        return { rows: [{ status: 'approved' }] };
      }
      if (sql.includes('UPDATE initiative_runs')) {
        updates.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    const res = await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(),
      checkAllTasksCompleted: vi.fn(),
      runPhaseCIfReady: vi.fn(),
    });
    expect(res.advanced).toBe(1);
    expect(updates.some(u => u.sql.includes("phase='B_task_loop'"))).toBe(true);
  });

  it('A_contract + contract draft → no update', async () => {
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'A_contract', current_task_id: null, contract_id: 'c-1' }] };
      }
      if (sql.includes('FROM initiative_contracts')) return { rows: [{ status: 'draft' }] };
      if (sql.includes('UPDATE initiative_runs')) throw new Error('should not update');
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    const res = await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(),
      checkAllTasksCompleted: vi.fn(),
      runPhaseCIfReady: vi.fn(),
    });
    expect(res.errors).toEqual([]);
    expect(res.advanced).toBe(0);
  });

  it('B_task_loop + current_task completed → update current_task_id to next runnable', async () => {
    const updates = [];
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'B_task_loop', current_task_id: 't-prev', contract_id: 'c-1' }] };
      }
      if (sql.includes('FROM tasks WHERE id')) return { rows: [{ status: 'completed' }] };
      if (sql.includes('UPDATE initiative_runs') || sql.includes('UPDATE tasks')) {
        updates.push(sql);
        return { rows: [] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    const res = await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(async () => ({ id: 't-next' })),
      checkAllTasksCompleted: vi.fn(),
      runPhaseCIfReady: vi.fn(),
    });
    expect(res.advanced).toBe(1);
    expect(updates.some(s => s.includes('current_task_id'))).toBe(true);
    expect(updates.some(s => s.includes('UPDATE tasks'))).toBe(true);
  });

  it('B_task_loop + current_task still running → skip', async () => {
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'B_task_loop', current_task_id: 't-now', contract_id: 'c-1' }] };
      }
      if (sql.includes('FROM tasks WHERE id')) return { rows: [{ status: 'running' }] };
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const nextFn = vi.fn();
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    await advanceHarnessInitiatives(pool, { nextRunnableTask: nextFn, checkAllTasksCompleted: vi.fn(), runPhaseCIfReady: vi.fn() });
    expect(nextFn).not.toHaveBeenCalled();
  });

  it('B_task_loop + no next + all tasks completed → call runPhaseCIfReady', async () => {
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'B_task_loop', current_task_id: null, contract_id: 'c-1' }] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const runC = vi.fn(async () => ({ status: 'e2e_pass' }));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(async () => null),
      checkAllTasksCompleted: vi.fn(async () => ({ all: true, total: 3, completed: 3, remaining: 0 })),
      runPhaseCIfReady: runC,
    });
    expect(runC).toHaveBeenCalledWith('init-1', expect.any(Object));
  });

  it('B_task_loop + no next + not all completed → no action', async () => {
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: 'run-1', initiative_id: 'init-1', phase: 'B_task_loop', current_task_id: null, contract_id: 'c-1' }] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const runC = vi.fn();
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(async () => null),
      checkAllTasksCompleted: vi.fn(async () => ({ all: false, total: 3, completed: 1, remaining: 2 })),
      runPhaseCIfReady: runC,
    });
    expect(runC).not.toHaveBeenCalled();
  });

  it('isolates per-run errors - one run throws, others still advance', async () => {
    let callSeq = 0;
    const updates = [];
    const queryHandler = async (sql) => {
      if (sql.includes('FROM initiative_runs') && !sql.includes('UPDATE')) {
        return {
          rows: [
            { id: 'run-bad', initiative_id: 'init-bad', phase: 'A_contract', current_task_id: null, contract_id: 'c-bad' },
            { id: 'run-good', initiative_id: 'init-good', phase: 'A_contract', current_task_id: null, contract_id: 'c-good' },
          ],
        };
      }
      if (sql.includes('FROM initiative_contracts')) {
        callSeq++;
        if (callSeq === 1) throw new Error('contract lookup failed');
        return { rows: [{ status: 'approved' }] };
      }
      if (sql.includes('UPDATE initiative_runs')) {
        updates.push(sql);
        return { rows: [] };
      }
      return { rows: [] };
    };
    const pool = makeMockPool(makeMockClient(queryHandler));
    const { advanceHarnessInitiatives } = await import('../harness-phase-advancer.js');
    const res = await advanceHarnessInitiatives(pool, {
      nextRunnableTask: vi.fn(),
      checkAllTasksCompleted: vi.fn(),
      runPhaseCIfReady: vi.fn(),
    });
    expect(res.errors.length).toBe(1);
    expect(res.advanced).toBe(1);
    expect(updates.length).toBe(1);
  });
});
