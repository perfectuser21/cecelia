/**
 * Harness v2 — advanceHarnessInitiatives 单元测试
 *
 * 覆盖：
 *   - A_contract + contract approved → phase='B_task_loop' + contract_id 回填
 *   - A_contract + 无 approved 合同 → A_pending（不动）
 *   - B_task_loop 有 current_task 且 running → B_busy（不动）
 *   - B_task_loop current_task completed → 拉下一 queued task（current_task_id 更新）
 *   - B_task_loop 无可运行 task 但仍有未完成 → B_waiting
 *   - B_task_loop 所有子 Task completed → runPhaseCIfReady 被调用（B_to_C）
 *   - 找不到 parent harness_initiative task → no_parent_task
 *   - 幂等：updated_at 时间窗口过滤 — 被 guard 遮住的行不会被 SELECT 出来
 *
 * 不连 PG；用 FakeClient mock query。参考 harness-initiative-runner-phase-c.test.js。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(() => Promise.reject(new Error('should not use real pool'))) },
}));

import { advanceHarnessInitiatives } from '../harness-phase-advancer.js';

// ─── FakeClient ────────────────────────────────────────────────────────────

class FakeClient {
  constructor(handlers) {
    this.handlers = handlers;
    this.calls = [];
    this.released = false;
  }

  async query(sql, params = []) {
    this.calls.push({ sql, params });
    for (const h of this.handlers) {
      const r = h(sql, params);
      if (r !== null && r !== undefined) {
        return Array.isArray(r) ? { rows: r } : r;
      }
    }
    return { rows: [] };
  }

  release() {
    this.released = true;
  }
}

function makePool(client) {
  return { connect: async () => client };
}

// 拼接 SQL 到 string + 粗略关键字匹配（与 phase-c 测试同风格）
function buildClient(routes) {
  return new FakeClient([
    (sql, params) => {
      for (const [key, responder] of Object.entries(routes)) {
        if (sql.includes(key)) {
          return typeof responder === 'function' ? responder(sql, params) : responder;
        }
      }
      return null;
    },
  ]);
}

// ─── A_contract → B_task_loop ─────────────────────────────────────────────

describe('advanceHarnessInitiatives — A_contract → B_task_loop', () => {
  it('有 approved 合同 → phase 升到 B_task_loop, contract_id 回填', async () => {
    const updates = [];
    const client = buildClient({
      'FROM initiative_runs\n       WHERE phase IN': [
        {
          run_id: 'run-A',
          initiative_id: 'init-1',
          contract_id: null,
          phase: 'A_contract',
          current_task_id: null,
        },
      ],
      'FROM initiative_contracts': [{ id: 'contract-42' }],
      'UPDATE initiative_runs': (sql, params) => {
        updates.push({ sql, params });
        return [];
      },
    });

    const res = await advanceHarnessInitiatives(makePool(client));
    expect(res).toHaveLength(1);
    expect(res[0].status).toBe('A_to_B');
    expect(res[0].contractId).toBe('contract-42');

    // 必须 phase='A_contract' 条件写回（乐观锁）
    const updSql = updates[0].sql;
    expect(updSql).toMatch(/phase='B_task_loop'/);
    expect(updSql).toMatch(/contract_id=\$1::uuid/);
    expect(updSql).toMatch(/phase='A_contract'/); // WHERE guard
    expect(updates[0].params[0]).toBe('contract-42');
    expect(updates[0].params[1]).toBe('run-A');
    expect(client.released).toBe(true);
  });

  it('无 approved 合同 → A_pending，不 UPDATE', async () => {
    let updateCount = 0;
    const client = buildClient({
      'FROM initiative_runs\n       WHERE phase IN': [
        {
          run_id: 'run-A',
          initiative_id: 'init-1',
          contract_id: null,
          phase: 'A_contract',
          current_task_id: null,
        },
      ],
      'FROM initiative_contracts': [],
      'UPDATE initiative_runs': () => { updateCount++; return []; },
    });
    const res = await advanceHarnessInitiatives(makePool(client));
    expect(res[0].status).toBe('A_pending');
    expect(updateCount).toBe(0);
  });
});

// ─── B_task_loop 各路径 ──────────────────────────────────────────────────

describe('advanceHarnessInitiatives — B_task_loop', () => {
  function baseBRoutes(overrides = {}) {
    return {
      'FROM initiative_runs\n       WHERE phase IN': [
        {
          run_id: 'run-B',
          initiative_id: 'init-1',
          contract_id: 'c1',
          phase: 'B_task_loop',
          current_task_id: overrides.currentTaskId ?? null,
        },
      ],
      "task_type='harness_initiative'": [{ id: 'parent-1' }],
      ...overrides.extra,
    };
  }

  it('current_task 仍 in_progress → B_busy（不拉下一）', async () => {
    let pickedNextTask = false;
    const client = buildClient(
      baseBRoutes({
        currentTaskId: 'task-running',
        extra: {
          'FROM tasks WHERE id=$1::uuid': [{ status: 'in_progress' }],
          'WHERE t.task_type': () => { pickedNextTask = true; return []; },
        },
      })
    );
    const res = await advanceHarnessInitiatives(makePool(client));
    expect(res[0].status).toBe('B_busy');
    expect(res[0].currentTaskId).toBe('task-running');
    expect(pickedNextTask).toBe(false);
  });

  it('current_task completed + 有下一 runnable → B_picked，current_task_id 更新', async () => {
    const updates = [];
    const statusUpdates = [];
    const client = buildClient(
      baseBRoutes({
        currentTaskId: 'task-done',
        extra: {
          'FROM tasks WHERE id=$1::uuid': [{ status: 'completed' }],
          // nextRunnableTask 的 SELECT t.* FROM tasks t WHERE t.task_type
          'WHERE t.task_type': [{ id: 'task-next', status: 'queued' }],
          'UPDATE initiative_runs': (sql, params) => {
            updates.push({ sql, params });
            return [];
          },
          "UPDATE tasks SET status='queued'": (sql, params) => {
            statusUpdates.push({ sql, params });
            return [];
          },
        },
      })
    );
    const res = await advanceHarnessInitiatives(makePool(client));
    expect(res[0].status).toBe('B_picked');
    expect(res[0].currentTaskId).toBe('task-next');
    const curUpd = updates.find((u) => u.sql.includes('current_task_id='));
    expect(curUpd).toBeTruthy();
    expect(curUpd.params[0]).toBe('task-next');
    expect(curUpd.params[1]).toBe('run-B');
    // PRD 要求保底 UPDATE tasks status=queued
    expect(statusUpdates).toHaveLength(1);
    expect(statusUpdates[0].params[0]).toBe('task-next');
  });

  it('无 current_task + 无 runnable + 仍有未完成 task → B_waiting', async () => {
    const client = buildClient(
      baseBRoutes({
        extra: {
          'WHERE t.task_type': [],
          'GROUP BY status': [
            { status: 'completed', cnt: 1 },
            { status: 'queued', cnt: 1 },
          ],
        },
      })
    );
    const res = await advanceHarnessInitiatives(makePool(client));
    expect(res[0].status).toBe('B_waiting');
    expect(res[0].remaining).toBe(1);
  });

  it('所有子 Task completed + 无 runnable → runPhaseCIfReady 被调用 (B_to_C)', async () => {
    const runPhaseC = vi.fn(async () => ({ status: 'e2e_pass', verdict: 'PASS' }));
    const client = buildClient(
      baseBRoutes({
        extra: {
          'WHERE t.task_type': [],
          'GROUP BY status': [{ status: 'completed', cnt: 3 }],
        },
      })
    );
    const res = await advanceHarnessInitiatives(makePool(client), { runPhaseC });
    expect(res[0].status).toBe('B_to_C');
    expect(res[0].phaseC.status).toBe('e2e_pass');
    expect(runPhaseC).toHaveBeenCalledTimes(1);
    expect(runPhaseC).toHaveBeenCalledWith('parent-1', expect.objectContaining({ pool: expect.anything() }));
  });

  it('找不到 parent harness_initiative task → no_parent_task', async () => {
    const client = buildClient({
      'FROM initiative_runs\n       WHERE phase IN': [
        {
          run_id: 'run-B',
          initiative_id: 'init-ghost',
          contract_id: 'c1',
          phase: 'B_task_loop',
          current_task_id: null,
        },
      ],
      "task_type='harness_initiative'": [],
    });
    const res = await advanceHarnessInitiatives(makePool(client));
    expect(res[0].status).toBe('no_parent_task');
  });
});

// ─── 多行混合 + 错误兜底 ──────────────────────────────────────────────

describe('advanceHarnessInitiatives — mixed + error handling', () => {
  it('同一 tick 处理多行，单行失败不影响其他', async () => {
    const runPhaseC = vi.fn();
    let contractLookup = 0;
    const client = new FakeClient([
      (sql) => {
        if (sql.includes('FROM initiative_runs\n       WHERE phase IN')) {
          return [
            {
              run_id: 'run-A', initiative_id: 'init-A',
              contract_id: null, phase: 'A_contract', current_task_id: null,
            },
            {
              run_id: 'run-A2', initiative_id: 'init-A2',
              contract_id: null, phase: 'A_contract', current_task_id: null,
            },
          ];
        }
        if (sql.includes('FROM initiative_contracts')) {
          contractLookup++;
          if (contractLookup === 1) throw new Error('db blew up');
          return [{ id: 'c-99' }];
        }
        if (sql.includes('UPDATE initiative_runs')) return [];
        return null;
      },
    ]);
    const res = await advanceHarnessInitiatives(makePool(client), { runPhaseC });
    expect(res).toHaveLength(2);
    expect(res[0].status).toBe('error');
    expect(res[0].error).toMatch(/db blew up/);
    expect(res[1].status).toBe('A_to_B');
    expect(client.released).toBe(true);
  });
});

// ─── 幂等：updated_at 时间窗口 ───────────────────────────────────────────

describe('advanceHarnessInitiatives — idempotency guard', () => {
  it('SELECT 使用 updated_at < NOW() - interval 过滤（guardSeconds 写进 params）', async () => {
    const queries = [];
    const client = new FakeClient([
      (sql, params) => {
        queries.push({ sql, params });
        return [];
      },
    ]);
    await advanceHarnessInitiatives(makePool(client), { guardSeconds: 7 });
    const selectCall = queries.find((q) => q.sql.includes('FROM initiative_runs'));
    expect(selectCall).toBeTruthy();
    expect(selectCall.sql).toMatch(/updated_at\s*<\s*NOW\(\)\s*-\s*\(\$1 \|\| ' seconds'\)::interval/);
    expect(selectCall.params[0]).toBe('7');
  });

  it('默认 guardSeconds=2', async () => {
    const queries = [];
    const client = new FakeClient([
      (sql, params) => { queries.push({ sql, params }); return []; },
    ]);
    await advanceHarnessInitiatives(makePool(client));
    const selectCall = queries.find((q) => q.sql.includes('FROM initiative_runs'));
    expect(selectCall.params[0]).toBe('2');
  });

  it('查询无结果（全部在 guard 窗口内）→ 返回空数组，不做任何 UPDATE', async () => {
    let updates = 0;
    const client = new FakeClient([
      (sql) => {
        if (sql.includes('UPDATE')) { updates++; return []; }
        return []; // 所有 SELECT 返回空
      },
    ]);
    const res = await advanceHarnessInitiatives(makePool(client));
    expect(res).toEqual([]);
    expect(updates).toBe(0);
  });
});
