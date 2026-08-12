/**
 * shepherd-fairness-budget.test.js
 *
 * RED→GREEN TDD for:
 *  I3: reconcileTerminalOpenPRs 公平性 — 使用 last_reconcile_checked_at 持久化 cursor 轮转
 *      >5 候选，两轮中第二轮必须处理第6+条，即使前5仍 OPEN。
 *  I4: 预算 — spawn timeout=min(perCallCap, remainingBudget)
 *      remaining<=0 不启动，禁止固定传 30000ms timeout。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('../quarantine.js', () => ({
  quarantineTask: vi.fn().mockResolvedValue({ success: true }),
}));

import { spawnSync } from 'child_process';
import { reconcileTerminalOpenPRs, _resetReconcileGateForTesting } from '../shepherd.js';

const VALID_PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4830';

// ════════════════════════════════════════════════════════════════
// I3: 公平性 — last_reconcile_checked_at cursor 轮转
// ════════════════════════════════════════════════════════════════

describe('[I3] reconcileTerminalOpenPRs — 公平性：cursor 轮转确保第6+任务被处理', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
    _resetReconcileGateForTesting();
  });

  it('[I3-1] 两轮调用：第1轮处理任务1-5，第2轮处理任务6（即使前5仍 OPEN）', async () => {
    // 6个候选任务，全部处于 OPEN 状态（不会被 MERGED）
    const allTasks = Array.from({ length: 6 }, (_, i) => ({
      id: `task-fair-${i + 1}`,
      title: `task ${i + 1}`,
      pr_url: `https://github.com/perfectuser21/cecelia/pull/${i + 1}`,
      pr_status: 'open',
      payload: {},
    }));

    // spawnSync 返回 OPEN（任务不推进）
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ state: 'OPEN', mergeable: 'CONFLICTING' }),
      stderr: '',
    });

    let selectCallCount = 0;
    const updatedCheckedIds = new Set();

    const pool = {
      query: vi.fn(async (sql, args) => {
        if (/FROM tasks/i.test(sql) && !/UPDATE/i.test(sql)) {
          selectCallCount++;
          // 有状态 fake：保存 cursor，并按生产语义重新排序；不是预编排“第二轮直接返回第6条”。
          const rows = [...allTasks]
            .sort((a, b) => {
              const aCursor = typeof a.payload.last_reconcile_checked_at === 'string'
                && /^\d{4}-\d{2}-\d{2}T/.test(a.payload.last_reconcile_checked_at)
                ? a.payload.last_reconcile_checked_at : '';
              const bCursor = typeof b.payload.last_reconcile_checked_at === 'string'
                && /^\d{4}-\d{2}-\d{2}T/.test(b.payload.last_reconcile_checked_at)
                ? b.payload.last_reconcile_checked_at : '';
              return aCursor.localeCompare(bCursor) || a.id.localeCompare(b.id);
            })
            .slice(0, 5);
          return { rows };
        }
        if (/UPDATE tasks SET payload/i.test(sql) && /last_reconcile_checked_at/i.test(sql)) {
          const task = allTasks.find(row => row.id === args?.[0]);
          if (task) {
            task.payload.last_reconcile_checked_at = args[1];
            updatedCheckedIds.add(task.id);
          }
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    // Round 1
    const r1 = await reconcileTerminalOpenPRs(pool);
    expect(r1.processed).toBe(5);

    // Round 1 应该为每个处理过的任务写入 last_reconcile_checked_at
    expect(updatedCheckedIds.size).toBe(5);
    for (let i = 1; i <= 5; i++) {
      expect(updatedCheckedIds.has(`task-fair-${i}`)).toBe(true);
    }

    // 重置 gate，模拟时间间隔已过
    _resetReconcileGateForTesting();
    vi.mocked(spawnSync).mockClear();

    // Round 2
    const r2 = await reconcileTerminalOpenPRs(pool);

    // 第2轮首个必须是此前未检查的任务6；随后才可回到旧任务。
    expect(r2.processed).toBe(5);
    expect(vi.mocked(spawnSync).mock.calls[0][1]).toContain('https://github.com/perfectuser21/cecelia/pull/6');

    // 总共两次 SELECT
    expect(selectCallCount).toBe(2);
  });

  it('[I3-2] SELECT 语句使用 last_reconcile_checked_at 排序（不固定 ORDER BY updated_at）', async () => {
    const capturedSqls = [];

    const pool = {
      query: vi.fn(async (sql) => {
        capturedSqls.push(sql);
        return { rows: [] };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    const selectSql = capturedSqls.find(s => /FROM tasks/i.test(s) && !/INSERT|UPDATE/i.test(s)) || '';
    // 必须包含 last_reconcile_checked_at 排序
    expect(selectSql.toLowerCase()).toContain('last_reconcile_checked_at');
    // payload 是通用 JSON，脏值不能通过强制 timestamptz cast 拖垮整批查询。
    expect(selectSql.toLowerCase()).not.toContain('::timestamptz');
    expect(selectSql).toMatch(/COALESCE\(payload->>'last_reconcile_checked_at',\s*''\)/i);
  });

  it('[I3-3] 处理完任务后写入 last_reconcile_checked_at（确保 payload 元数据更新）', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ state: 'OPEN', mergeable: 'CONFLICTING' }),
      stderr: '',
    });

    const updatedPayloads = [];

    const pool = {
      query: vi.fn(async (sql, args) => {
        if (/FROM tasks/i.test(sql) && !/UPDATE/i.test(sql)) {
          return {
            rows: [{
              id: 'task-check-001',
              title: 'test task',
              pr_url: VALID_PR_URL,
              pr_status: 'open',
              payload: {},
            }],
          };
        }
        if (/UPDATE tasks SET payload/i.test(sql) && /last_reconcile_checked_at/i.test(sql)) {
          updatedPayloads.push({ taskId: args?.[0], data: args?.[1] });
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    // 必须为任务写入 last_reconcile_checked_at
    expect(updatedPayloads.length).toBeGreaterThan(0);
    expect(updatedPayloads[0].taskId).toBe('task-check-001');
    // 第二个参数应该是 ISO 时间字符串
    const isoStr = updatedPayloads[0].data;
    expect(typeof isoStr).toBe('string');
    expect(new Date(isoStr).toISOString()).toBe(isoStr);
  });
});

// ════════════════════════════════════════════════════════════════
// I4: 预算 — per-call timeout = min(perCallCap, remaining)
// ════════════════════════════════════════════════════════════════

describe('[I4] reconcileTerminalOpenPRs — spawn timeout=min(perCallCap, remaining)', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
    _resetReconcileGateForTesting();
  });

  it('[I4-1] budget=2000ms: 每次 spawn 耗时1001ms，第3个任务未启动（remaining<=0）', async () => {
    let elapsedMs = 0;
    const capturedTimeouts = [];

    vi.mocked(spawnSync).mockImplementation((cmd, args, opts) => {
      capturedTimeouts.push(opts?.timeout);
      elapsedMs += 1001; // 每次调用"耗时" 1001ms
      return {
        status: 0,
        stdout: JSON.stringify({ state: 'OPEN', mergeable: 'CONFLICTING' }),
        stderr: '',
      };
    });

    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `task-budget-${i + 1}`,
      title: `task ${i + 1}`,
      pr_url: VALID_PR_URL,
      pr_status: 'open',
      payload: {},
    }));

    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM tasks/i.test(sql) && !/UPDATE/i.test(sql)) return { rows };
        return { rows: [], rowCount: 0 };
      }),
    };

    const result = await reconcileTerminalOpenPRs(pool, {
      budget_ms: 2000,
      _elapsedMsFn: () => elapsedMs,
    });

    // budget=2000: call1(elapsed=0, remaining=2000) → ok; call2(elapsed=1001, remaining=999) → ok; call3(elapsed=2002, remaining<=0) → 不启动
    expect(result.processed).toBe(2);
    expect(vi.mocked(spawnSync)).toHaveBeenCalledTimes(2);

    // 传给 spawnSync 的 timeout 不得超过 remaining
    // call1: remaining=2000, timeout=min(30000,2000)=2000
    // call2: remaining=999, timeout=min(30000,999)=999
    expect(capturedTimeouts[0]).toBe(2000);
    expect(capturedTimeouts[1]).toBe(999);
    expect(capturedTimeouts[0]).toBeLessThanOrEqual(2000);
    expect(capturedTimeouts[1]).toBeLessThanOrEqual(999);

    // 禁止固定传 30000
    for (const t of capturedTimeouts) {
      expect(t).not.toBe(30000);
    }
  });

  it('[I4-2] budget=5000ms 但 remaining 充足：timeout=min(30000, remaining)', async () => {
    let elapsedMs = 0;
    const capturedTimeouts = [];

    vi.mocked(spawnSync).mockImplementation((cmd, args, opts) => {
      capturedTimeouts.push(opts?.timeout);
      elapsedMs += 100; // 每次只耗 100ms
      return {
        status: 0,
        stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN', mergedAt: '2026-08-12T10:00:00Z' }),
        stderr: '',
      };
    });

    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM tasks/i.test(sql) && !/UPDATE/i.test(sql)) {
          return {
            rows: [{
              id: 'task-budget-x',
              title: 'task x',
              pr_url: VALID_PR_URL,
              pr_status: 'open',
              payload: {},
            }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    await reconcileTerminalOpenPRs(pool, {
      budget_ms: 5000,
      _elapsedMsFn: () => elapsedMs,
    });

    expect(capturedTimeouts.length).toBeGreaterThan(0);
    // remaining=5000-0=5000, perCallCap=30000 → timeout=min(30000,5000)=5000
    expect(capturedTimeouts[0]).toBe(5000);
    // 绝对不能传超过 default budget（25000）
    expect(capturedTimeouts[0]).toBeLessThanOrEqual(5000);
  });

  it('[I4-3] remaining<=0 时任务不启动，spawnSync 不被调用', async () => {
    let elapsedMs = 99999; // 已超预算

    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ state: 'OPEN' }),
      stderr: '',
    });

    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM tasks/i.test(sql) && !/UPDATE/i.test(sql)) {
          return {
            rows: [{ id: 'task-skip', title: 'should skip', pr_url: VALID_PR_URL, pr_status: 'open', payload: {} }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const result = await reconcileTerminalOpenPRs(pool, {
      budget_ms: 1000,
      _elapsedMsFn: () => elapsedMs,
    });

    // remaining <= 0 时不启动
    expect(result.processed).toBe(0);
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
  });

  it('[I4-4] 默认 budget 25000ms：timeout <= 25000（绝不传 30000）', async () => {
    let elapsedMs = 0;
    const capturedTimeouts = [];

    vi.mocked(spawnSync).mockImplementation((cmd, args, opts) => {
      capturedTimeouts.push(opts?.timeout);
      elapsedMs += 100;
      return {
        status: 0,
        stdout: JSON.stringify({ state: 'OPEN' }),
        stderr: '',
      };
    });

    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM tasks/i.test(sql) && !/UPDATE/i.test(sql)) {
          return {
            rows: [{ id: 'task-default', title: 'default', pr_url: VALID_PR_URL, pr_status: 'open', payload: {} }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    // 不传 budget_ms → 使用默认 25000ms
    await reconcileTerminalOpenPRs(pool, {
      _elapsedMsFn: () => elapsedMs,
    });

    expect(capturedTimeouts.length).toBeGreaterThan(0);
    // 默认 budget=25000 → timeout=min(30000,25000)=25000，绝不是 30000
    expect(capturedTimeouts[0]).toBe(25000);
    expect(capturedTimeouts[0]).not.toBe(30000);
    expect(capturedTimeouts[0]).toBeLessThanOrEqual(25000);
  });

  it('[I4-5] remaining 大于 30 秒时，单次调用仍封顶 30000ms', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ state: 'OPEN' }),
      stderr: '',
    });
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM tasks/i.test(sql) && !/UPDATE/i.test(sql)) {
          return { rows: [{ id: 'task-cap', title: 'cap', pr_url: VALID_PR_URL, pr_status: 'open', payload: {} }] };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool, { budget_ms: 60000, _elapsedMsFn: () => 0 });

    expect(vi.mocked(spawnSync).mock.calls[0][2].timeout).toBe(30000);
  });

  it('[I4-6] spawn 超时 status=null 时 fail closed，并计入 errors', async () => {
    const timeoutError = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    vi.mocked(spawnSync).mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: timeoutError,
    });
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM tasks/i.test(sql) && !/UPDATE/i.test(sql)) {
          return { rows: [{ id: 'task-timeout', title: 'timeout', pr_url: VALID_PR_URL, pr_status: 'open', payload: {} }] };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const result = await reconcileTerminalOpenPRs(pool, { budget_ms: 5000, _elapsedMsFn: () => 0 });

    expect(result).toMatchObject({ processed: 1, reconciled: 0, errors: 1 });
  });
});
