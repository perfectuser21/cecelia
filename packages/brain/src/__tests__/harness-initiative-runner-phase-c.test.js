/**
 * Harness v2 M5 — harness-initiative-runner 阶段 C 单元测试
 *
 * 覆盖：
 *   - checkAllTasksCompleted 全 done / 部分 done / 空集
 *   - createFixTask 正确写 fix_round + original_task_id
 *   - runPhaseCIfReady not_ready（子任务未全完）
 *   - runPhaseCIfReady no_contract（无 approved 合同）
 *   - runPhaseCIfReady e2e_pass → initiative_runs phase='done'
 *   - runPhaseCIfReady e2e_fail → 建 fix task + fix_round++，phase 回 B
 *   - runPhaseCIfReady fix_round > MAX → phase='failed' + failure_reason
 *   - runPhaseCIfReady 父任务找不到 → error
 *   - runPhaseCIfReady initiative_runs 缺失 → error
 *
 * 不连 PG；用 FakeClient mock query。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 被测文件导入 db.js 默认 pool — 给个占位 mock，实际走 opts.pool
vi.mock('../db.js', () => ({
  default: { connect: vi.fn(() => Promise.reject(new Error('should not use real pool'))) },
}));

import {
  checkAllTasksCompleted,
  createFixTask,
  runPhaseCIfReady,
} from '../harness-initiative-runner.js';

// ─── FakeClient：根据 SQL 关键字分派响应 ─────────────────────────────────

class FakeClient {
  constructor(handlers) {
    this.handlers = handlers; // Array<(sql, params) => rows | null>
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

// ─── checkAllTasksCompleted ────────────────────────────────────────────────

describe('checkAllTasksCompleted', () => {
  it('全部 completed → all=true', async () => {
    const client = new FakeClient([
      (sql) => sql.includes('GROUP BY status')
        ? [{ status: 'completed', cnt: 3 }]
        : null,
    ]);
    const r = await checkAllTasksCompleted('parent-1', client);
    expect(r.all).toBe(true);
    expect(r.total).toBe(3);
    expect(r.completed).toBe(3);
    expect(r.remaining).toBe(0);
  });

  it('部分 completed → all=false', async () => {
    const client = new FakeClient([
      (sql) => sql.includes('GROUP BY status')
        ? [
            { status: 'completed', cnt: 2 },
            { status: 'queued', cnt: 1 },
          ]
        : null,
    ]);
    const r = await checkAllTasksCompleted('parent-1', client);
    expect(r.all).toBe(false);
    expect(r.total).toBe(3);
    expect(r.completed).toBe(2);
    expect(r.remaining).toBe(1);
  });

  it('无子任务 → all=false（total=0 特殊兜底）', async () => {
    const client = new FakeClient([(sql) => (sql.includes('GROUP BY status') ? [] : null)]);
    const r = await checkAllTasksCompleted('parent-1', client);
    expect(r.all).toBe(false);
    expect(r.total).toBe(0);
  });
});

// ─── createFixTask ─────────────────────────────────────────────────────────

describe('createFixTask', () => {
  it('写入 fix_mode + fix_round + original_task_id', async () => {
    const calls = [];
    const client = new FakeClient([
      (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT title, description, payload FROM tasks')) {
          return [{
            title: 'Task A',
            description: 'orig desc',
            payload: { logical_task_id: 'A', files: ['a.js'], dod: ['dod-1'] },
          }];
        }
        if (sql.includes('INSERT INTO tasks')) {
          return [{ id: 'new-uuid-1' }];
        }
        return null;
      },
    ]);

    const id = await createFixTask({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-1',
      taskId: 'task-A',
      fixRound: 2,
      failureScenarios: [
        { name: 'KPI 链路', exitCode: 2, output: 'err' },
      ],
      client,
    });

    expect(id).toBe('new-uuid-1');
    const insertCall = calls.find((c) => c.sql.includes('INSERT INTO tasks'));
    expect(insertCall).toBeTruthy();
    const payload = JSON.parse(insertCall.params[2]);
    expect(payload.fix_mode).toBe(true);
    expect(payload.fix_round).toBe(2);
    expect(payload.original_task_id).toBe('task-A');
    expect(payload.parent_task_id).toBe('parent-1');
    expect(payload.files).toEqual(['a.js']);
    expect(payload.failure_scenarios.length).toBe(1);
    expect(insertCall.params[0]).toMatch(/fix-r2/);
    expect(insertCall.params[1]).toMatch(/FIX round 2/);
    expect(insertCall.params[1]).toMatch(/KPI 链路/);
  });

  it('原 task 不存在 → 仍能建 fix task（容错）', async () => {
    const client = new FakeClient([
      (sql) => {
        if (sql.includes('SELECT title, description, payload FROM tasks')) {
          return [];
        }
        if (sql.includes('INSERT INTO tasks')) {
          return [{ id: 'new-uuid-2' }];
        }
        return null;
      },
    ]);
    const id = await createFixTask({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-1',
      taskId: 'ghost',
      fixRound: 1,
      failureScenarios: [],
      client,
    });
    expect(id).toBe('new-uuid-2');
  });
});

// ─── runPhaseCIfReady helpers ──────────────────────────────────────────────

function buildClientSequence(sqlToResponse) {
  return new FakeClient([
    (sql, params) => {
      for (const [key, responder] of Object.entries(sqlToResponse)) {
        if (sql.includes(key)) {
          return typeof responder === 'function' ? responder(sql, params) : responder;
        }
      }
      return null;
    },
  ]);
}

// ─── runPhaseCIfReady — not_ready ──────────────────────────────────────────

describe('runPhaseCIfReady — not_ready', () => {
  it('子任务未全完 → not_ready', async () => {
    const client = buildClientSequence({
      'FROM tasks WHERE id =': [{ id: 'parent-1', payload: { initiative_id: 'init-1' } }],
      'GROUP BY status': [
        { status: 'completed', cnt: 2 },
        { status: 'queued', cnt: 1 },
      ],
    });
    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
      runE2E: async () => { throw new Error('不应被调用'); },
    });
    expect(r.status).toBe('not_ready');
    expect(r.completed).toBe(2);
    expect(r.total).toBe(3);
    expect(client.released).toBe(true);
  });
});

// ─── runPhaseCIfReady — no_contract ────────────────────────────────────────

describe('runPhaseCIfReady — no_contract', () => {
  it('找不到 approved 合同 → no_contract', async () => {
    const client = buildClientSequence({
      'FROM tasks WHERE id =': [{ id: 'parent-1', payload: { initiative_id: 'init-1' } }],
      'GROUP BY status': [{ status: 'completed', cnt: 2 }],
      'FROM initiative_contracts': [], // 无 approved
    });
    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
      runE2E: async () => { throw new Error('不应被调用'); },
    });
    expect(r.status).toBe('no_contract');
  });

  it('合同 e2e_acceptance 为 null → no_contract', async () => {
    const client = buildClientSequence({
      'FROM tasks WHERE id =': [{ id: 'parent-1', payload: { initiative_id: 'init-1' } }],
      'GROUP BY status': [{ status: 'completed', cnt: 1 }],
      'FROM initiative_contracts': [{ id: 'c1', e2e_acceptance: null }],
    });
    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
      runE2E: async () => { throw new Error('不应被调用'); },
    });
    expect(r.status).toBe('no_contract');
  });
});

// ─── runPhaseCIfReady — e2e_pass ───────────────────────────────────────────

describe('runPhaseCIfReady — e2e_pass', () => {
  it('PASS → phase=done + completed_at=NOW', async () => {
    const updates = [];
    const client = buildClientSequence({
      'FROM tasks WHERE id =': [{ id: 'parent-1', payload: { initiative_id: 'init-1' } }],
      'GROUP BY status': [{ status: 'completed', cnt: 3 }],
      'FROM initiative_contracts': [{
        id: 'c1',
        e2e_acceptance: {
          scenarios: [{ name: 's', covered_tasks: ['t1'], commands: [{ cmd: 'x' }] }],
        },
      }],
      'FROM initiative_runs': [{ id: 'run-1', phase: 'B_task_loop' }],
      'UPDATE initiative_runs': (sql) => {
        updates.push(sql);
        return [];
      },
    });
    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
      runE2E: async () => ({ verdict: 'PASS', failedScenarios: [] }),
    });
    expect(r.status).toBe('e2e_pass');
    expect(r.verdict).toBe('PASS');
    expect(r.runId).toBe('run-1');
    // 先 phase='C_final_e2e' 再 phase='done'
    expect(updates.some((s) => s.includes("phase='C_final_e2e'"))).toBe(true);
    expect(updates.some((s) => s.includes("phase='done'") && s.includes('completed_at=NOW()'))).toBe(true);
  });
});

// ─── runPhaseCIfReady — e2e_fail → 建 fix task ────────────────────────────

describe('runPhaseCIfReady — e2e_fail', () => {
  it('首次失败 → 建 fix task + fix_round=1, phase 退回 B', async () => {
    const inserts = [];
    const updates = [];
    let fixIdCounter = 0;

    const client = new FakeClient([
      (sql, params) => {
        if (sql.includes('FROM tasks WHERE id =')) {
          return [{ id: 'parent-1', payload: { initiative_id: 'init-1' } }];
        }
        if (sql.includes('GROUP BY status')) {
          return [{ status: 'completed', cnt: 2 }];
        }
        if (sql.includes('FROM initiative_contracts')) {
          return [{
            id: 'c1',
            e2e_acceptance: {
              scenarios: [
                { name: 's-A', covered_tasks: ['task-a'], commands: [{ cmd: 'x' }] },
                { name: 's-B', covered_tasks: ['task-b'], commands: [{ cmd: 'y' }] },
              ],
            },
          }];
        }
        if (sql.includes('FROM initiative_runs')) {
          return [{ id: 'run-1', phase: 'B_task_loop' }];
        }
        if (sql.includes('UPDATE initiative_runs')) {
          updates.push(sql);
          return [];
        }
        // 查 fix_round 历史：首次为 0
        if (sql.includes("MAX((payload->>'fix_round')::int)")) {
          return [{ max_round: 0 }];
        }
        // 取原 task
        if (sql.includes('SELECT title, description, payload FROM tasks')) {
          return [{
            title: params[0] === 'task-a' ? 'Task A' : 'Task B',
            description: 'orig',
            payload: { files: [], dod: [] },
          }];
        }
        if (sql.includes('INSERT INTO tasks')) {
          fixIdCounter += 1;
          const p = JSON.parse(params[2]);
          inserts.push({ title: params[0], fixRound: p.fix_round, originalTaskId: p.original_task_id });
          return [{ id: `fix-${fixIdCounter}` }];
        }
        return null;
      },
    ]);

    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
      runE2E: async () => ({
        verdict: 'FAIL',
        failedScenarios: [
          { name: 's-A', covered_tasks: ['task-a'], exitCode: 1, output: 'bad' },
          { name: 's-B', covered_tasks: ['task-b'], exitCode: 2, output: 'worse' },
        ],
      }),
    });

    expect(r.status).toBe('e2e_fail');
    expect(r.verdict).toBe('FAIL');
    expect(r.fixTaskIds.length).toBe(2);
    expect(r.failureAttribution.length).toBe(2);
    expect(r.failureAttribution.every((a) => a.nextRound === 1)).toBe(true);

    // 建了 2 个 fix task，fix_round=1
    expect(inserts.length).toBe(2);
    expect(inserts.every((i) => i.fixRound === 1)).toBe(true);

    // phase 最终回到 B_task_loop
    expect(updates.some((s) => s.includes("phase='B_task_loop'"))).toBe(true);
  });

  it('fix_round 已到 MAX → 不建 fix task + phase=failed + failure_reason', async () => {
    const inserts = [];
    const updates = [];

    const client = new FakeClient([
      (sql) => {
        if (sql.includes('FROM tasks WHERE id =')) {
          return [{ id: 'parent-1', payload: { initiative_id: 'init-1' } }];
        }
        if (sql.includes('GROUP BY status')) {
          return [{ status: 'completed', cnt: 1 }];
        }
        if (sql.includes('FROM initiative_contracts')) {
          return [{
            id: 'c1',
            e2e_acceptance: {
              scenarios: [
                { name: 's', covered_tasks: ['task-a'], commands: [{ cmd: 'x' }] },
              ],
            },
          }];
        }
        if (sql.includes('FROM initiative_runs')) {
          return [{ id: 'run-1', phase: 'B_task_loop' }];
        }
        if (sql.includes('UPDATE initiative_runs')) {
          updates.push(sql);
          return [];
        }
        if (sql.includes("MAX((payload->>'fix_round')::int)")) {
          // 已经有 3 轮 fix，下一轮会是 4 > 3 → terminal fail
          return [{ max_round: 3 }];
        }
        if (sql.includes('INSERT INTO tasks')) {
          inserts.push(sql);
          return [{ id: 'new-fix' }];
        }
        if (sql.includes('SELECT title, description, payload FROM tasks')) {
          return [{ title: 'T', description: 'd', payload: {} }];
        }
        return null;
      },
    ]);

    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
      runE2E: async () => ({
        verdict: 'FAIL',
        failedScenarios: [{
          name: 'scenario-fatal', covered_tasks: ['task-a'], exitCode: 1, output: 'oops',
        }],
      }),
    });

    expect(r.status).toBe('e2e_failed_terminal');
    expect(r.verdict).toBe('FAIL');
    expect(r.fixTaskIds).toEqual([]);
    expect(r.failureAttribution[0].nextRound).toBe(4);
    expect(r.error).toMatch(/task=task-a/);

    // 不应建新 fix task
    expect(inserts.length).toBe(0);
    // phase='failed' + failure_reason
    const fail = updates.find((s) => s.includes("phase='failed'"));
    expect(fail).toBeTruthy();
    expect(fail).toMatch(/failure_reason/);
  });

  it('可配置 maxFixRounds（传入 1）', async () => {
    const client = new FakeClient([
      (sql) => {
        if (sql.includes('FROM tasks WHERE id =')) {
          return [{ id: 'parent-1', payload: { initiative_id: 'init-1' } }];
        }
        if (sql.includes('GROUP BY status')) return [{ status: 'completed', cnt: 1 }];
        if (sql.includes('FROM initiative_contracts')) {
          return [{
            id: 'c1',
            e2e_acceptance: {
              scenarios: [{ name: 's', covered_tasks: ['task-a'], commands: [{ cmd: 'x' }] }],
            },
          }];
        }
        if (sql.includes('FROM initiative_runs')) return [{ id: 'run-1', phase: 'B_task_loop' }];
        if (sql.includes("MAX((payload->>'fix_round')::int)")) return [{ max_round: 1 }];
        if (sql.includes('UPDATE initiative_runs')) return [];
        return null;
      },
    ]);
    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
      runE2E: async () => ({
        verdict: 'FAIL',
        failedScenarios: [{ name: 's', covered_tasks: ['task-a'], exitCode: 1, output: '' }],
      }),
      maxFixRounds: 1,
    });
    expect(r.status).toBe('e2e_failed_terminal');
  });
});

// ─── runPhaseCIfReady — error paths ────────────────────────────────────────

describe('runPhaseCIfReady — error paths', () => {
  it('initiativeTaskId 缺失 → 抛错', async () => {
    await expect(runPhaseCIfReady('')).rejects.toThrow(/initiativeTaskId required/);
    await expect(runPhaseCIfReady(null)).rejects.toThrow();
  });

  it('父任务找不到 → error', async () => {
    const client = buildClientSequence({
      'FROM tasks WHERE id =': [],
    });
    const r = await runPhaseCIfReady('missing', {
      pool: makePool(client),
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/parent initiative task not found/);
  });

  it('initiative_runs 行缺失 → error', async () => {
    const client = buildClientSequence({
      'FROM tasks WHERE id =': [{ id: 'parent-1', payload: { initiative_id: 'init-1' } }],
      'GROUP BY status': [{ status: 'completed', cnt: 1 }],
      'FROM initiative_contracts': [{ id: 'c1', e2e_acceptance: { scenarios: [{ name: 's', covered_tasks: ['t'], commands: [{ cmd: 'x' }] }] } }],
      'FROM initiative_runs': [],
    });
    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/initiative_runs row missing/);
  });

  it('runE2E 抛错 → error 且 client 被 release', async () => {
    const client = buildClientSequence({
      'FROM tasks WHERE id =': [{ id: 'parent-1', payload: { initiative_id: 'init-1' } }],
      'GROUP BY status': [{ status: 'completed', cnt: 1 }],
      'FROM initiative_contracts': [{
        id: 'c1',
        e2e_acceptance: { scenarios: [{ name: 's', covered_tasks: ['t'], commands: [{ cmd: 'x' }] }] },
      }],
      'FROM initiative_runs': [{ id: 'run-1', phase: 'B_task_loop' }],
      'UPDATE initiative_runs': [],
    });
    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
      runE2E: async () => { throw new Error('docker crashed'); },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/docker crashed/);
    expect(client.released).toBe(true);
  });

  it('父任务无 initiative_id → 用 parent.id 兜底', async () => {
    const client = buildClientSequence({
      'FROM tasks WHERE id =': [{ id: 'parent-1', payload: {} }],
      'GROUP BY status': [{ status: 'queued', cnt: 1 }],
    });
    const r = await runPhaseCIfReady('parent-1', {
      pool: makePool(client),
    });
    // not_ready（子任务未全完），但 initiativeId 用 parent.id
    expect(r.status).toBe('not_ready');
    expect(r.initiativeId).toBe('parent-1');
  });
});
